let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let Article = syzoj.model('article');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let Practice = syzoj.model('practice');
let User = syzoj.model('user');
let UserPrivilege = syzoj.model('user_privilege');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
let PracticePlayer = syzoj.model('practice_player');
let ProblemForbid = syzoj.model("problem_forbid")
const calcRating = require('../libs/rating');

app.get('/admin/info', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let allSubmissionsCount = await JudgeState.count();
    let todaySubmissionsCount = await JudgeState.count({
      submit_time: TypeORM.MoreThanOrEqual(syzoj.utils.getCurrentDate(true))
    });
    let problemsCount = await Problem.count();
    let articlesCount = await Article.count();
    let contestsCount = await Contest.count();
    let practicesCount = await Practice.count();
    let usersCount = await User.count();

    res.render('admin_info', {
      allSubmissionsCount: allSubmissionsCount,
      todaySubmissionsCount: todaySubmissionsCount,
      problemsCount: problemsCount,
      articlesCount: articlesCount,
      contestsCount: contestsCount,
      practicesCount: practicesCount,
      usersCount: usersCount
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

let configItems = {
  'title': { name: '站点标题', type: String },
  'google_analytics': { name: 'Google Analytics', type: String },
  '默认参数': null,
  'default.problem.time_limit': { name: '时间限制（单位：ms）', type: Number },
  'default.problem.memory_limit': { name: '空间限制（单位：MiB）', type: Number },
  '限制': null,
  'limit.time_limit': { name: '最大时间限制（单位：ms）', type: Number },
  'limit.memory_limit': { name: '最大空间限制（单位：MiB）', type: Number },
  'limit.data_size': { name: '所有数据包大小（单位：byte）', type: Number },
  'limit.testdata': { name: '测试数据大小（单位：byte）', type: Number },
  'limit.submit_code': { name: '代码长度（单位：byte）', type: Number },
  'limit.submit_answer': { name: '提交答案题目答案大小（单位：byte）', type: Number },
  'limit.custom_test_input': { name: '自定义测试输入文件大小（单位：byte）', type: Number },
  'limit.testdata_filecount': { name: '测试数据文件数量（单位：byte）', type: Number },
  '每页显示数量': null,
  'page.problem': { name: '题库', type: Number },
  'page.judge_state': { name: '提交记录', type: Number },
  'page.problem_statistics': { name: '题目统计', type: Number },
  'page.ranklist': { name: '排行榜', type: Number },
  'page.discussion': { name: '讨论', type: Number },
  'page.article_comment': { name: '评论', type: Number },
  'page.contest': { name: '比赛', type: Number },
  'page.practice': { name: '练习', type: Number }
};

app.get('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      configItems[i].val = eval(`syzoj.config.${i}`);
    }

    res.render('admin_config', {
      items: configItems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/config', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    for (let i in configItems) {
      if (!configItems[i]) continue;
      if (req.body[i]) {
        let val;
        if (configItems[i].type === Boolean) {
          val = req.body[i] === 'on';
        } else if (configItems[i].type === Number) {
          val = Number(req.body[i]);
        } else {
          val = req.body[i];
        }

        let f = new Function('val', `syzoj.config.${i} = val`);
        f(val);
      }
    }

    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'config']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let a = await UserPrivilege.find();
    let users = {};
    for (let p of a) {
      if (!users[p.user_id]) {
        users[p.user_id] = {
          user: await User.findById(p.user_id),
          privileges: []
        };
      }

      users[p.user_id].privileges.push(p.privilege);
    }

    res.render('admin_privilege', {
      users: Object.values(users)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/privilege', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let data = JSON.parse(req.body.data);
    for (let id in data) {
      let user = await User.findById(id);
      if (!user) throw new ErrorMessage(`不存在 ID 为 ${id} 的用户。`);
      await user.setPrivileges(data[id]);
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'privilege']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rating', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contests = await Contest.find({
      order: {
        start_time: 'DESC'
      }
    });
    const calcs = await RatingCalculation.find({
      order: {
        id: 'DESC'
      }
    });
    for (const calc of calcs) await calc.loadRelationships();

    res.render('admin_rating', {
      contests: contests,
      calcs: calcs
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/rating/virtual', async (req, res) => {
  try {
    let query = Contest.createQueryBuilder()
      .where('title LIKE :title', {title: `${req.body.prefix}%`})
      .orderBy('start_time', 'DESC');
    const contests = (await Contest.queryAll(query)).slice(0, req.body.number).reverse();
    let rating = {};
    for (let contest of contests) {
      const getps = await contest.ranklist.getPlayers();

      const players = [];
      if (contest.type == 'acm') {
        for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) {
          const user = await User.findById((await ContestPlayer.findById(contest.ranklist.ranklist[i])).user_id);
          players.push({
            user: user,
            rank: i,
            currentRating: rating.hasKey(user.username) ? rating.get(user.username) : 1500
          });
        }
      } else {
        for (let i = 1, now_score = -1, now_rank = 1; i <= contest.ranklist.ranklist.player_num; i++) {
          const user = await User.findById((await ContestPlayer.findById(contest.ranklist.ranklist[i])).user_id);
          let score = getps[i - 1].score;
          if (score != now_score) now_score = score, now_rank = i;
          players.push({
            user: user,
            rank: now_rank,
            currentRating: rating.hasKey(user.username) ? rating.get(user.username) : 1500
          });
        }
      }
      const newRating = calcRating(players);

      for (let player of newRating) {
        rating[player.user.username] = player.currentRating;
      }
    };
    const sortedRating = Object.entries(rating).sort((a, b) => b[1]-a[1]); // a[0]:username a[1]:rating
    res.send({data: sortedRating});
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err : e
    });
  }
});

app.post('/admin/rating/add', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const contest = await Contest.findById(req.body.contest);
    if (!contest) throw new ErrorMessage('无此比赛');

    await contest.loadRelationships();
    const newcalc = await RatingCalculation.create({ contest_id: contest.id });
    await newcalc.save();

    if (!contest.ranklist || contest.ranklist.ranklist.player_num <= 1) {
      throw new ErrorMessage("比赛人数太少。");
    }

    const getps = await contest.ranklist.getPlayers ();

    const players = [];
    if (contest.type == 'acm') {
      for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) {
        const user = await User.findById((await ContestPlayer.findById(contest.ranklist.ranklist[i])).user_id);
        players.push({
          user: user,
          rank: i,
          currentRating: user.rating
        });
      }
    } else {
      for (let i = 1, now_score = -1, now_rank = 1; i <= contest.ranklist.ranklist.player_num; i++) {
        const user = await User.findById((await ContestPlayer.findById(contest.ranklist.ranklist[i])).user_id);
        let score = getps[i - 1].score;
        if (score != now_score) now_score = score, now_rank = i;
        players.push({
          user: user,
          rank: now_rank,
          currentRating: user.rating
        });
      }
    }
    const newRating = calcRating(players);
    for (let i = 0; i < newRating.length; i++) {
      const user = newRating[i].user;
      user.rating = newRating[i].currentRating;
      await user.save();
      const newHistory = await RatingHistory.create({
        rating_calculation_id: newcalc.id,
        user_id: user.id,
        rating_after: newRating[i].currentRating,
        rank: newRating[i].rank
      });
      await newHistory.save();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/admin/rating/delete', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const calcList = await RatingCalculation.find({
      where: {
        id: TypeORM.MoreThanOrEqual(req.body.calc_id)
      },
      order: {
        id: 'DESC'
      }
    });
    if (calcList.length === 0) throw new ErrorMessage('ID 不正确');

    for (let i = 0; i < calcList.length; i++) {
      await calcList[i].delete();
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'rating']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_other');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_rejudge', {
      form: {},
      count: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/other', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.type === 'reset_count') {
      const users = await User.find()
      for(const u of users) {
        await u.refreshSubmitInfo()
      }
      const problems = await Problem.find();
      for (const p of problems) {
        await p.resetSubmissionCount()
      }
    } else if (req.body.type === 'reset_discussion') {
      const articles = await Article.find();
      for (const a of articles) {
        await a.resetReplyCountAndTime();
      }
    } else if (req.body.type === 'reset_codelen') {
      const submissions = await JudgeState.find();
      for (const s of submissions) {
        if (s.type !== 'submit-answer') {
          s.code_length = Buffer.from(s.code).length;
          await s.save();
        }
      }
    } else {
      throw new ErrorMessage("操作类型不正确");
    }

    res.redirect(syzoj.utils.makeUrl(['admin', 'other']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});
app.post('/admin/rejudge', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    let query = JudgeState.createQueryBuilder();
    let w = "1 = 1 "

    let user = await User.fromName(req.body.submitter || '');
    if (user) {
      query.andWhere('user_id = :user_id', { user_id: user.id });
      w += `AND user_id = ${user.id} `
    } else if (req.body.submitter) {
      query.andWhere('user_id = :user_id', { user_id: 0 });
    }

    let minID = parseInt(req.body.min_id);
    if (!isNaN(minID)) {
      query.andWhere('id >= :minID', { minID })
      w += `AND id >= ${minID} `
    }
    let maxID = parseInt(req.body.max_id);
    if (!isNaN(maxID)) {
      query.andWhere('id <= :maxID', { maxID })
      w += `AND id <= ${maxID} `
    }

    let minScore = parseInt(req.body.min_score);
    if (!isNaN(minScore)) {
      query.andWhere('score >= :minScore', { minScore });
      w += `AND score >= ${minScore} `
    }
    let maxScore = parseInt(req.body.max_score);
    if (!isNaN(maxScore)) {
      query.andWhere('score <= :maxScore', { maxScore });
      w += `AND score <= ${maxScore} `
    }

    let minTime = syzoj.utils.parseDate(req.body.min_time);
    if (!isNaN(minTime)) {
      query.andWhere('submit_time >= :minTime', { minTime: parseInt(minTime) });
      w += `AND submit_time >= ${minTime} `
    }
    let maxTime = syzoj.utils.parseDate(req.body.max_time);
    if (!isNaN(maxTime)) {
      query.andWhere('submit_time <= :maxTime', { maxTime: parseInt(maxTime) });
      w += `AND submit_time <= ${maxTime} `
    }

    if (req.body.language) {
      if (req.body.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
      } else if (req.body.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');;
      } else {
        query.andWhere('language = :language', { language: req.body.language });
        w += `AND language = ${req.body.language} `
      }
    }

    if (req.body.status) {
      query.andWhere('status = :status', { status: req.body.status });
      w += `AND status = '${req.body.status}'`;
    }

    if (req.body.problem_id) {
      query.andWhere('problem_id = :problem_id', { problem_id: parseInt(req.body.problem_id) || 0 })
      w += `AND problem_id = ${parseInt(req.body.problem_id) || 0} `
    }

    query.andWhere(`id IN (SELECT MAX(id) FROM judge_state WHERE ${w} GROUP BY user_id)`)

    let count = await JudgeState.countQuery(query);
    if (req.body.type === 'rejudge') {
      let submissions = await JudgeState.queryAll(query);

      for (let submission of submissions) {
        await submission.rejudge();
      }
    }

    res.render('admin_rejudge', {
      form: req.body,
      count: count
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_links', {
      links: syzoj.config.links || []
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/links', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.config.links = JSON.parse(req.body.data);
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'links']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_raw', {
      data: JSON.stringify(syzoj.config, null, 2)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.post('/admin/raw', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.config = JSON.parse(req.body.data);
    await syzoj.utils.saveConfig();

    res.redirect(syzoj.utils.makeUrl(['admin', 'raw']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/restart', async (req, res) => {
  try {
    if (!res.locals.user) throw new ErrorMessage('您没有权限进行此操作。');
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    syzoj.restart();

    res.render('admin_restart', {
      data: JSON.stringify(syzoj.config, null, 2)
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/serviceID', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.send({
        serviceID: syzoj.serviceID
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/account_generation', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('admin_account_generation', {})
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});


app.post('/admin/account_generation', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let data = JSON.parse(req.body.data)
    let accounts = data.accounts
    if(!accounts || accounts.length <= 0)  throw new ErrorMessage('需要生成的账号不能为空 。');
    const end_time = data.end_time
    if (isNaN(end_time)) throw new ErrorMessage('账户过期时间错误 。');

    let total = accounts.length
    const wait = new Promise((resolve, reject) => {
      accounts.forEach(account => {
        let user = User.create({
          username: account.username,
          nickname: account.nickname,
          password: account.password,
          group_id: account.group_id,
          rating: syzoj.config.default.user.rating,
          is_show: syzoj.config.default.user.show,
          register_time: syzoj.utils.getCurrentDate(),
          start_time: syzoj.utils.getCurrentDate(),
          end_time
        })
        user.save()
            .then(_ => account.result = "YES")
            .catch(e => account.result = "NO , error=" + e)
            .finally(() => {
              total--
              if(total === 0) resolve(true)
            })
      })
    })
    await wait;
    res.send(accounts)
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});




app.get('/admin/problem', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let query = ProblemForbid.createQueryBuilder();
    let paginate = syzoj.utils.paginate(await ProblemForbid.countForPagination(query), req.query.page, 20);
    let data = await ProblemForbid.queryPage(paginate, query, {
      forbid_submission_end_time: 'DESC'
    });
    res.render('admin_problem', {
      data,
      paginate
    })
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});

app.get('/admin/problem_forbid/contest/:id', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const id = parseInt(req.params.id)
    let c = await Contest.findById(id)
    if(!c) throw new ErrorMessage('找不到比赛。');
    res.send({title:c.title, end_time: syzoj.utils.formatDate(c.end_time)})
  } catch (e) {
    res.send({error: e})
  }
});

app.get('/admin/problem_forbid', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.query.id)
    let action = parseInt(req.query.action)
    if(isNaN(id) || isNaN(action)) throw new ErrorMessage('参数错误');
    if(action === 0) { // problem forbid
      let time = parseInt(req.query.end_time)
      if(isNaN(time)) throw new ErrorMessage('参数错误');
      let problem = await Problem.findById(id)
      if(!problem) throw new ErrorMessage('找不到题目')
      problem_forbid = await ProblemForbid.create({
        problem_id: id,
        problem_title: problem.title,
        contest_id: 0,
        forbid_submission_end_time: time
      })
      await problem_forbid.save()
    } else if(action === 1) { // delete problem forbid
      let problem_forbid = await ProblemForbid.findOne({problem_id: id})
      if(problem_forbid) await problem_forbid.destroy()
    } else if(action === 2) { // contest forbid
      let time = parseInt(req.query.end_time)
      if(isNaN(time)) throw new ErrorMessage('参数错误');
      let contest = await Contest.findById(id)
      if(!contest) throw new ErrorMessage('不存在该比赛')
      pids = await contest.getProblems()
      if (pids.length > 0) {
        problems = await Problem.queryAll(Problem.createQueryBuilder().where("id in (" + pids.join(",") + ")"))
        for(let problem of problems) {
          problem_forbid = await ProblemForbid.create({
            problem_id: problem.id,
            problem_title: problem.title,
            contest_id: id,
            forbid_submission_end_time: time
          })
          await problem_forbid.save()
        }
      }
    } else if(action === 3) { // delete contest forbid
      let problem_forbids = await ProblemForbid.queryAll(ProblemForbid.createQueryBuilder().where("contest_id = " + id));
      for(let p of problem_forbids) {
        await p.destroy()
      }
    }
    res.send({msg: "ok"})
  } catch (e) {
    res.send({error: e})
    syzoj.log(e);
  }
});

app.get('/admin/change_problem_creator', async (req, res) => {
  try {
    if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

    res.render('change_problem_creator', {})
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    })
  }
});