const fs = require('fs'),
      path = require('path'),
      util = require('util'),
      http = require('http'),
      serializejs = require('serialize-javascript'),
      UUID = require('uuid'),
      commandLineArgs = require('command-line-args');

const optionDefinitions = [
  { name: 'config', alias: 'c', type: String, defaultValue: __dirname + '/config.json' },
];

const options = commandLineArgs(optionDefinitions);

require('reflect-metadata');

global.Promise = require('bluebird');

// Disable 'Warning: a promise was created in a handler at ...'
Promise.config({
  warnings: {
    wForgottenReturn: false
  }
});

const vjBasics = require('./remote-judge/basic')
const vj = require('./remote-judge/vj')
const provider = require("./remote-judge/provider")
const bodyParser = require("body-parser");

const makeIntervalCheckFunc = (interval = 10) => {
  const mp = new Map()
  return function (id) {
    let current = Math.floor(new Date().getTime() / 1000)
    let last_time = mp.get(id)
    if(last_time && current - last_time <= interval) return false
    mp.set(id, current)
    return true
  }
}


global.syzoj = {
  rootDir: __dirname,
  config: require('object-assign-deep')({}, require('./config-example.json'), require(options.config)),
  languages: require('./language-config.json'),
  configDir: options.config,
  models: [],
  modules: [],
  db: null,
  newLuoguHelper: require("./remote-judge/luogu/helper").newLuoguHelper,
  ProblemType:  {
    Traditional : "traditional",
    SubmitAnswer : "submit-answer",
    Interaction : "interaction",
    Remote : "remote"
  },
  PrivilegeType: {
    ManageProblem: 'manage_problem',
    ManageProblemTag: 'manage_problem_tag',
    ManageUser: 'manage_user',
    AddProblem: 'add_problem'
  },
  vjBasics,
  vjs: vjBasics.VjBasic,
  vj,
  provider,
  submissionIntervalCheck: makeIntervalCheckFunc(),
  getRemoteProblemLink(source) {
    let info = vjBasics.parseSource(source)
    return provider.get_problem_link(info.vjName, info.problemId)
  },
  serviceID: UUID(),
  log(obj) {
    if (obj instanceof ErrorMessage) return;
    console.log(obj);
  },
  checkMigratedToTypeORM() {
    const userConfig = require(options.config);
    if (!userConfig.db.migrated_to_typeorm) {
      app.use((req, res) => res.send('Please refer to <a href="https://github.com/syzoj/syzoj/wiki/TypeORM-%E8%BF%81%E7%A7%BB%E6%8C%87%E5%8D%97">TypeORM Migration Guide</a>.'));
      app.listen(parseInt(syzoj.config.port), syzoj.config.hostname);
      return false;
    }

    return true;
  },
  async run() {

    require("./remote-judge/boot").boot_remote_judge_server();

    // Check config
    if (syzoj.config.session_secret === '@SESSION_SECRET@'
     || syzoj.config.judge_token === '@JUDGE_TOKEN@'
     || (syzoj.config.email_jwt_secret === '@EMAIL_JWT_SECRET@' && syzoj.config.register_mail)
     || syzoj.config.db.password === '@DATABASE_PASSWORD@') {
      console.log('Please generate and fill the secrets in config!');
      process.exit();
    }

    let Express = require('express');
    global.app = Express();

    if (!this.checkMigratedToTypeORM()) return;

    syzoj.production = app.get('env') === 'production';
    let winstonLib = require('./libs/winston');
    winstonLib.configureWinston(!syzoj.production);

    this.utils = require('./utility');

    // Set assets dir
    app.use(Express.static(__dirname + '/static', { maxAge: syzoj.production ? '1y' : 0 }));

    // Set template engine ejs
    app.set('view engine', 'ejs');

    // Use body parser
    let bodyParser = require('body-parser');
    app.use(bodyParser.urlencoded({
      extended: true,
      limit: '50mb'
    }));
    app.use(bodyParser.json({ limit: '50mb' }));

    // Use cookie parser
    app.use(require('cookie-parser')());
    app.locals.serializejs = serializejs;

    let multer = require('multer');
    app.multer = multer({ dest: syzoj.utils.resolvePath(syzoj.config.upload_dir, 'tmp') });

    // This should before load api_v2, to init the `res.locals.user`
    this.loadHooks();
    // Trick to bypass CSRF for APIv2
    app.use((() => {
      let router = new Express.Router();
      app.apiRouter = router;
      require('./modules/api_v2');
      return router;
    })());

    app.server = http.createServer(app);

    await this.connectDatabase();
    this.loadModules();

    // redis and redisCache is for syzoj-renderer
    const redis = require('redis');
    this.redis = redis.createClient(this.config.redis);
    this.redisCache = {
      get: util.promisify(this.redis.get).bind(this.redis),
      set: util.promisify(this.redis.set).bind(this.redis)
    };

    if (!module.parent) {
      // Loaded by node CLI, not by `require()`.

      if (process.send) {
        // if it's started by child_process.fork(), it must be requested to restart
        // wait until parent process quited.
        await new Promise((resolve, reject) => {
          process.on('message', message => {
            if (message === 'quited') resolve()
          });
          process.send('quit');
        });
      }

      await this.lib('judger').connect();

      app.server.listen(parseInt(syzoj.config.port), syzoj.config.hostname, () => {
        this.log(`SYZOJ is listening on ${syzoj.config.hostname}:${parseInt(syzoj.config.port)}...`);
      });
    }
  },
  restart() {
    console.log('Will now fork a new process.');
    const child = require('child_process').fork(__filename, ['-c', options.config]);
    child.on('message', (message) => {
      if (message !== 'quit') return;

      console.log('Child process requested "quit".')
      app.server.close(()=>{
        child.send('quited', err => {
          if (err) console.error('Error sending "quited" to child process:', err);
          process.exit();
        });
      })
    });
  },
  async connectDatabase() {
    // Patch TypeORM to workaround https://github.com/typeorm/typeorm/issues/3636
    const TypeORMMysqlDriver = require('typeorm/driver/mysql/MysqlDriver');
    const OriginalNormalizeType = TypeORMMysqlDriver.MysqlDriver.prototype.normalizeType;
    TypeORMMysqlDriver.MysqlDriver.prototype.normalizeType = function (column) {
      if (column.type === 'json') {
        return 'longtext';
      }
      return OriginalNormalizeType(column);
    };

    const TypeORM = require('typeorm');
    global.TypeORM = TypeORM;

    const modelsPath = __dirname + '/models/';
    const modelsBuiltPath = __dirname + '/models-built/';
    const models = fs.readdirSync(modelsPath)
                     .filter(filename => filename.endsWith('.ts') && filename !== 'common.ts')
                     .map(filename => require(modelsBuiltPath + filename.replace('.ts', '.js')).default);

    await TypeORM.createConnection({
      type: 'mariadb',
      host: this.config.db.host.split(':')[0],
      port: this.config.db.host.split(':')[1] || 3306,
      username: this.config.db.username,
      password: this.config.db.password,
      database: this.config.db.database,
      entities: models,
      synchronize: true,
      logging: !syzoj.production,
      extra: {
        connectionLimit: 50
      }
    });
  },
  loadModules() {
    fs.readdir(__dirname + '/modules/', (err, files) => {
      if (err) {
        this.log(err);
        return;
      }
      files.filter((file) => file.endsWith('.js'))
           .forEach((file) => this.modules.push(require(`./modules/${file}`)));
    });
  },
  lib(name) {
    return require(`./libs/${name}`);
  },
  model(name) {
    return require(`./models-built/${name}`).default;
  },
  loadHooks() {
    let Session = require('express-session');
    let FileStore = require('session-file-store')(Session);
    let sessionConfig = {
      secret: this.config.session_secret,
      cookie: { httpOnly: false },
      rolling: true,
      saveUninitialized: true,
      resave: true,
      store: new FileStore
    };
    if (syzoj.production) {
      app.set('trust proxy', 1);
      sessionConfig.cookie.secure = false;
    }
    app.use(Session(sessionConfig));

    app.use((req, res, next) => {
      res.locals.useLocalLibs = !!parseInt(req.headers['syzoj-no-cdn']) || syzoj.config.no_cdn;

      let User = syzoj.model('user');


      // let loginlog = syzoj.model('loginlog');
      // async function login_log(uid,uname,ip){
      //     let last = await loginlog.findOne({
      //         where:{user_id:uid,username:uname,ip:ip},
      //         order:{login_time:'DESC'}
      //     });
      //     let now = new Date();
      //   //   console.log(now);
      //   //   console.log(last);
      //     if ( last && now - last.login_time < 1000*60*30 ){
      //         return;// 如果同一用户,同一IP, 登录时间在30分钟内, 则不记录
      //     }
      //     rec = await loginlog.create({
      //         user_id : uid,
      //         username : uname,
      //         login_time : now,
      //         ip : ip
      //     });
      //     rec.save();
      // }
      function getClientIp(req) {
          let ip =  req.headers['x-forwarded-for'] || // 判断是否有反向代理 IP
          req.connection.remoteAddress || // 判断 connection 的远程 IP
          req.socket.remoteAddress || // 判断后端的 socket 的 IP
          req.connection.socket.remoteAddress;
          if (ip.indexOf(',') !== -1) {
            ip = ip.split(',')[0];
          }
          
          return ip;
      }

      res.locals.loginIp = getClientIp(req);
      if (req.session.user_id) {
        User.findById(req.session.user_id).then((user) => {
          res.locals.user = user;
          // login_log(res.locals.user.id,res.locals.user.username,getClientIp(req));
          next();
        }).catch((err) => {
          this.log(err);
          res.locals.user = null;
          req.session.user_id = null;
          next();
        });
      } else {
        if (req.cookies.login) {
          let obj;
          try {
            obj = JSON.parse(req.cookies.login);
            User.findOne({
              where: {
                username: obj[0],
                password: obj[1]
              }
            }).then(user => {
              if (!user || user.isEnded ()) throw null;
              res.locals.user = user;
              req.session.user_id = user.id;
              // login_log(res.locals.user.id,res.locals.user.username,getClientIp(req));
              next();
            }).catch(err => {
              console.log(err);
              res.locals.user = null;
              req.session.user_id = null;
              next();
            });
          } catch (e) {
            res.locals.user = null;
            req.session.user_id = null;
            next();
          }
        } else {
          res.locals.user = null;
          req.session.user_id = null;
          next();
        }
      }
    });

    // Active item on navigator bar
    app.use((req, res, next) => {
      res.locals.active = req.path.split('/')[1];
      next();
    });

    app.use((req, res, next) => {
      res.locals.req = req;
      res.locals.res = res;
      next();
    });
  }
};

syzoj.untilStarted = syzoj.run();
