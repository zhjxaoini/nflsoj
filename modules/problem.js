let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let FormattedCode = syzoj.model('formatted_code');
let Contest = syzoj.model('contest');
let Practice = syzoj.model('practice');
const ProblemSummary = syzoj.model('problem_summary')
const User = syzoj.model('user')
let ProblemTag = syzoj.model('problem_tag');
let Article = syzoj.model('article');
let LoginLog = syzoj.model('loginlog');
let ProblemEvaluate = syzoj.model('problem_evaluate');
let ProblemNote = syzoj.model('problem_note');
let ContestPlayer = syzoj.model('contest_player');
let child_process = require('child_process')

const randomstring = require('randomstring');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');
const {QueryBuilder} = require("typeorm");

let Judger = syzoj.lib('judger');
let CodeFormatter = syzoj.lib('code_formatter');

function get_key(problem_id) {
  return syzoj.utils.md5(problem_id + "problem_xxx")
}

app.get('/problems', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}

    // if(!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) throw new ErrorMessage('您没有权限进行此操作。');
    if(!res.locals.user) throw new ErrorMessage('您没有权限进行此操作。');

    const privileges = await res.locals.user.getPrivileges()
    const allowedManageProblem = privileges.includes(syzoj.PrivilegeType.ManageProblem)
    const allowedAddProblem = privileges.includes(syzoj.PrivilegeType.AddProblem)
    if(!allowedManageProblem && !allowedAddProblem) throw new ErrorMessage('您没有权限进行此操作。');

    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate', 'publicize_time'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder();
    if(!allowedManageProblem) {
      query.where('user_id = :user_id', { user_id: res.locals.user.id })
    }

    // if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
    //   if (res.locals.user) {
    //     query.where('is_public = 1')
    //          .orWhere('user_id = :user_id', { user_id: res.locals.user.id });
    //   } else {
    //     query.where('is_public = 1');
    //   }
    // }

    if (sort === 'ac_rate') {
      query.orderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.orderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await problems.forEachAsync(async problem => {
      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.judge_state = await problem.getJudgeState(res.locals.user, true);
      problem.tags = await problem.getTags();
      problem.contestCount = await Contest.createQueryBuilder()
      .where(`problems REGEXP '^(.*[^0-9])?${problem.id}([^0-9].*)?$'`)
      .getCount();
    });
    
    let all_tags = await ProblemTag.find(); 
    all_tags.sort((a, b) => {
      return a.color > b.color ? 1 : -1;
    });
    
    res.render('problems', {
      all_tags, 
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problems/search', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.query.keyword) || 0;
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder();
    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
      if (res.locals.user) {
        query.where(new TypeORM.Brackets(qb => {
             qb.where('is_public = 1')
                 .orWhere('user_id = :user_id', { user_id: res.locals.user.id })
             }))
             .andWhere(new TypeORM.Brackets(qb => {
               qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
                 .orWhere('id = :id', { id: id })
                 .orWhere('source LIKE :source', { source: `%${req.query.keyword}%` })
             }));
      } else {
        query.where('is_public = 1')
             .andWhere(new TypeORM.Brackets(qb => {
               qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
                 .orWhere('id = :id', { id: id })
                 .orWhere('source LIKE :source', { source: `%${req.query.keyword}%` })
             }));
      }
    } else {
      query.where('title LIKE :title', { title: `%${req.query.keyword}%` })
           .orWhere('id = :id', { id: id })
           .orWhere('source LIKE :source', { source: `%${req.query.keyword}%` })
    }

    query.orderBy('id = ' + id.toString(), 'DESC');
    if (sort === 'ac_rate') {
      query.addOrderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.addOrderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await problems.forEachAsync(async problem => {
      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.judge_state = await problem.getJudgeState(res.locals.user, true);
      problem.tags = await problem.getTags();
      problem.contestCount = await Contest.createQueryBuilder()
      .where(`problems REGEXP '^(.*[^0-9])?${problem.id}([^0-9].*)?$'`)
      .getCount();
    });

    let all_tags = await ProblemTag.find(); 
    all_tags.sort((a, b) => {
      return a.color > b.color ? 1 : -1;
    });
    res.render('problems', {
      all_tags,
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problems/tag/:tagIDs', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) throw new ErrorMessage('您没有权限进行此操作。');
    let tagIDs = Array.from(new Set(req.params.tagIDs.split(',').map(x => parseInt(x))));
    let tags = await tagIDs.mapAsync(async tagID => ProblemTag.findById(tagID));
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let sortVal;
    if (sort === 'ac_rate') {
      sortVal = '`problem`.`ac_num` / `problem`.`submit_num`';
    } else {
      sortVal = '`problem`.`' + sort + '`';
    }

    // Validate the tagIDs
    for (let tag of tags) {
      if (!tag) {
        return res.redirect(syzoj.utils.makeUrl(['problems']));
      }
    }

    let sql = 'SELECT `id` FROM `problem` WHERE\n';
    for (let tagID of tagIDs) {
      if (tagID !== tagIDs[0]) {
        sql += 'AND\n';
      }

      sql += '`problem`.`id` IN (SELECT `problem_id` FROM `problem_tag_map` WHERE `tag_id` = ' + tagID + ')';
    }

    if (!res.locals.user || !await res.locals.user.hasPrivilege('manage_problem')) {
      if (res.locals.user) {
        sql += 'AND (`problem`.`is_public` = 1 OR `problem`.`user_id` = ' + res.locals.user.id + ')';
      } else {
        sql += 'AND (`problem`.`is_public` = 1)';
      }
    }

    let paginate = syzoj.utils.paginate(await Problem.countQuery(sql), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.query(sql + ` ORDER BY ${sortVal} ${order} ` + paginate.toSQL());

    problems = await problems.mapAsync(async problem => {
      // query() returns plain objects.
      problem = await Problem.findById(problem.id);

      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.judge_state = await problem.getJudgeState(res.locals.user, true);
      problem.tags = await problem.getTags();
      problem.contestCount = await Contest.createQueryBuilder()
      .where(`problems REGEXP '^(.*[^0-9])?${problem.id}([^0-9].*)?$'`)
      .getCount();

      return problem;
    });

    let all_tags = await ProblemTag.find(); 
    all_tags.sort((a, b) => {
      return a.color > b.color ? 1 : -1;
    });

    res.render('problems', {
      all_tags, 
      allowedManageTag: res.locals.user && await res.locals.user.hasPrivilege('manage_problem_tag'),
      problems: problems,
      tags: tags,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');
    
    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);
    
    let key = get_key(id);
    if(!res.locals.user && key !== req.query.key){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if (!(
      req.query.key == key || (
        await res.locals.user.allowedAddProblem() &&
        await problem.isAllowedUseBy(res.locals.user) &&
        (problem.is_public || problem.allowedEdit)
      )
    )) throw new ErrorMessage('您没有权限进行此操作。');

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = res.locals.user ? await problem.getJudgeState(res.locals.user, true) : null;
    let allow_edit_tag = res.locals.user ? res.locals.user.is_admin || (syzoj.config.allow_tag_edit && state && state.status === 'Accepted') : null
    
    problem.tags = await problem.getTags();
    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    let discussionCount = await Article.count({ problem_id: id });

    res.render('problem', {
      problem: problem,
      state: state,
      allow_edit_tag,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      discussionCount: discussionCount,
      key
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/pdf/:ids', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    const ids = req.params.ids.split(',').map(id => parseInt(id.trim(), 10));
    let combinedContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Problems</title>
        <link href="/cdnjs/semantic-ui/2.4.1/semantic.min.css" rel="stylesheet">
      </head>
      <body>
    `;
    let index = 0;

    for (const id of ids) {
      const problem = await Problem.findById(id);
      if (!problem) {
        continue; // Skip non-existing problems
      }

      // Generate HTML content as before
      await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);
      alpha = number => {
        if (number && parseInt(number) == number && parseInt(number) > 0) return String.fromCharCode('A'.charCodeAt(0) + parseInt(number) - 1);
      };
      let htmlContent = `
        <div style="break-after: page;">
          <h1>${alpha(index + 1)}. ${syzoj.utils.removeTitleTag(problem.title)}</h1>
          <strong>时间限制:</strong> ${problem.time_limit} ms<br>
          <strong>内存限制:</strong> ${problem.memory_limit} MIB<br>
          ${problem.description ? '<h2>题目描述</h2>' + problem.description : ''}
          ${problem.input_format ? '<h2>输入格式</h2>' + problem.input_format : ''}
          ${problem.output_format ? '<h2>输出格式</h2>' + problem.output_format : ''}
          ${problem.example ? '<h2>样例</h2>' + problem.example : ''}
          ${problem.limit_and_hint ? '<h2>数据范围与提示</h2>' + problem.limit_and_hint : ''}
        </div>
      `;
      combinedContent += htmlContent;
      index++;
    }
    res.send(combinedContent);
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});


app.get('/problem/:id/export', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem || !problem.is_public) throw new ErrorMessage('无此题目。');

    let obj = {
      title: problem.title,
      description: problem.description,
      input_format: problem.input_format,
      output_format: problem.output_format,
      example: problem.example,
      limit_and_hint: problem.limit_and_hint,
      time_limit: problem.time_limit,
      memory_limit: problem.memory_limit,
      have_additional_file: problem.additional_file_id != null,
      file_io: problem.file_io,
      file_io_input_name: problem.file_io_input_name,
      file_io_output_name: problem.file_io_output_name,
      type: problem.type,
      tags: []
    };

    let tags = await problem.getTags();

    obj.tags = tags.map(tag => tag.name);

    res.send({ success: true, obj: obj });
  } catch (e) {
    syzoj.log(e);
    res.send({ success: false, error: e });
  }
});

app.get('/problem/:id/edit', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);

    if (!problem) {
      if (!await res.locals.user.allowedAddProblem()) throw new ErrorMessage('您没有权限进行此操作。');
      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });
      problem.id = id;
      problem.allowedEdit = true;
      problem.tags = [];
      problem.new = true;
      problem.description = [
        '### 样例1输入',
        '```plain',
        '',
        '```',
        '### 样例1输出',
        '```plain',
        '',
        '```'].join('\n');
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);
      problem.tags = await problem.getTags();
    }

    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    res.render('problem_edit', {
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/edit', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);
    if (!problem) {
      if (!await res.locals.user.allowedAddProblem()) throw new ErrorMessage('您没有权限进行此操作。');

      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });


      let customID = parseInt(req.body.id);
      if (customID) {
        if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        problem.id = customID;
      } else if (id) problem.id = id;


      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {

      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

      let customID = parseInt(req.body.id);
      if (customID && customID !== id) {
        if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        await problem.changeID(customID);
      }
    }

    if (!req.body.title.trim()) throw new ErrorMessage('题目名不能为空。');

    const source = req.body.source.trim()
    if (req.body.type === syzoj.ProblemType.Remote) {
      if(problem.type !== syzoj.ProblemType.Remote || problem.source !== source) {
        const info = syzoj.vjBasics.parseSource(source)
        // const oj = syzoj.vj[info.vjName]
        if(!syzoj.vjs[info.vjName]) throw new ErrorMessage('找不到远程 OJ : ' + info.vjName)
        try {
          // const p = await oj.getProblem(info.problemId)
          const p = await syzoj.provider.get_problem(info.vjName.toLowerCase(), info.problemId)

          if(p == null) throw ""
          problem.type = syzoj.ProblemType.Remote
        } catch (e) {
          throw new ErrorMessage('找到不题目: ' + source)
        }
      }
    } else if (problem.type === syzoj.ProblemType.Remote) {
      problem.type = syzoj.ProblemType.Traditional
    }

    problem.source = source
    problem.title = req.body.title;
    problem.description = req.body.description;
    problem.input_format = req.body.input_format;
    problem.output_format = req.body.output_format;
    if(!isNaN(parseInt(req.body.time_limit))) problem.time_limit = req.body.time_limit;
    if(!isNaN(parseInt(req.body.memory_limit)))  problem.memory_limit = req.body.memory_limit
    problem.example = req.body.example;
    problem.limit_and_hint = req.body.limit_and_hint;
    
    if(res.locals.user.is_admin){
        problem.is_anonymous = (req.body.is_anonymous === 'on');
    }else{
        problem.is_anonymous = 0 ;
    }

    // Save the problem first, to have the `id` allocated
    await problem.save();

    if (!req.body.tags) {
      req.body.tags = [];
    } else if (!Array.isArray(req.body.tags)) {
      req.body.tags = [req.body.tags];
    }

    let newTagIDs = await req.body.tags.map(x => parseInt(x)).filterAsync(async x => ProblemTag.findById(x));
    await problem.setTags(newTagIDs);

    res.redirect(syzoj.utils.makeUrl(['problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/import', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);

    if (!problem) {
      if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });
      problem.id = id;
      problem.new = true;
      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    problem.allowedManage = await problem.isAllowedManageBy(res.locals.user);

    res.render('problem_import', {
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/import', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.params.id) || 0;
    let problem = await Problem.findById(id);
    if (!problem) {
      if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });

      if (await res.locals.user.hasPrivilege('manage_problem')) {
        let customID = parseInt(req.body.id);
        if (customID) {
          if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
          problem.id = customID;
        } else if (id) problem.id = id;
      }

      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {
      if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    let request = require('request-promise');
    let url = require('url');

    let json = await request({
      uri: req.body.url + (req.body.url.endsWith('/') ? 'export' : '/export'),
      timeout: 1500,
      json: true
    });

    if (!json.success) throw new ErrorMessage('题目加载失败。', null, json.error);

    if (!json.obj.title.trim()) throw new ErrorMessage('题目名不能为空。');
    problem.title = json.obj.title;
    problem.description = json.obj.description;
    problem.input_format = json.obj.input_format;
    problem.output_format = json.obj.output_format;
    problem.example = json.obj.example;
    problem.limit_and_hint = json.obj.limit_and_hint;
    problem.time_limit = json.obj.time_limit;
    problem.memory_limit = json.obj.memory_limit;
    problem.file_io = json.obj.file_io;
    problem.file_io_input_name = json.obj.file_io_input_name;
    problem.file_io_output_name = json.obj.file_io_output_name;
    if (json.obj.type) problem.type = json.obj.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    await problem.save();

    let tagIDs = (await json.obj.tags.mapAsync(name => ProblemTag.findOne({ where: { name: name } }))).filter(x => x).map(tag => tag.id);
    await problem.setTags(tagIDs);

    let download = require('download');
    let tmp = require('tmp-promise');
    let tmpFile = await tmp.file();

    try {
      let data = await download(req.body.url + (req.body.url.endsWith('/') ? 'testdata/download' : '/testdata/download'));
      await fs.writeFile(tmpFile.path, data);
      await problem.updateTestdata(tmpFile.path, await res.locals.user.hasPrivilege('manage_problem'));
      if (json.obj.have_additional_file) {
        let additional_file = await download(req.body.url + (req.body.url.endsWith('/') ? 'download/additional_file' : '/download/additional_file'));
        await fs.writeFile(tmpFile.path, additional_file);
        await problem.updateFile(tmpFile.path, 'additional_file', await res.locals.user.hasPrivilege('manage_problem'));
      }
    } catch (e) {
      syzoj.log(e);
    }

    res.redirect(syzoj.utils.makeUrl(['problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// The 'manage' is not `allow manage`'s 'manage', I just have no better name for it.
app.get('/problem/:id/manage', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    res.render('problem_manage', {
      problem: problem,
      testcases: testcases
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/manage', app.multer.fields([{ name: 'testdata', maxCount: 1 }, { name: 'additional_file', maxCount: 1 }]), async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();
    if(problem.type ===  syzoj.ProblemType.Remote || req.body.type === syzoj.ProblemType.Remote)  throw new ErrorMessage('远程测评的配置无法修改, 请在题目编辑页面进行修改。');

    problem.time_limit = req.body.time_limit;
    problem.memory_limit = req.body.memory_limit;
    if (req.body.type === 'traditional') {
      problem.file_io = req.body.io_method === 'file-io';
      problem.file_io_input_name = req.body.file_io_input_name;
      problem.file_io_output_name = req.body.file_io_output_name;
    }

    if (problem.type === 'submit-answer' && req.body.type !== 'submit-answer' || problem.type !== 'submit-answer' && req.body.type === 'submit-answer') {
      if (await JudgeState.count({ problem_id: id }) !== 0) {
        throw new ErrorMessage('已有提交的题目不允许在提交答案和非提交答案之间更改。');
      }
    }
    problem.type = req.body.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    if (req.files['testdata']) {
      await problem.updateTestdata(req.files['testdata'][0].path, await res.locals.user.hasPrivilege('manage_problem'));
    }

    if (req.files['additional_file']) {
      await problem.updateFile(req.files['additional_file'][0].path, 'additional_file', await res.locals.user.hasPrivilege('manage_problem'));
    }

    await problem.save();

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'manage']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// Set problem public
async function setPublic(req, res, is_public) {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    let allowedManage = await problem.isAllowedManageBy(res.locals.user);
    if (!allowedManage) throw new ErrorMessage('您没有权限进行此操作。');

    problem.is_public = is_public;
    problem.publicizer_id = res.locals.user.id;
    problem.publicize_time = new Date();
    await problem.save();

    JudgeState.query('UPDATE `judge_state` SET `is_public` = ' + is_public + ' WHERE `problem_id` = ' + id);

    res.redirect(syzoj.utils.makeUrl(['problem', id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
}

app.post('/problem/:id/public', async (req, res) => {
  await setPublic(req, res, true);
});

app.post('/problem/:id/dis_public', async (req, res) => {
  await setPublic(req, res, false);
});

// Set problem public
async function setEvaluate(req, res, evaluate) {
  try {
    try {
      if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
      let id = parseInt(req.params.id);
      let problem = await Problem.findById(id);
      if (!problem) throw new ErrorMessage('无此题目。');

      let allowedEvaluate = await problem.isAllowedEvaluateBy(res.locals.user);
      if (!allowedEvaluate) throw new ErrorMessage('您获得 15 分及以上才可以评价。');

      await ProblemEvaluate.setUserEvaluate(problem.id, res.locals.user.id, evaluate);

      res.send({ error_code: 1 });
    } catch (e) {
      syzoj.log(e);
      let err = e;
      if (!(err instanceof ErrorMessage)) {
        err = new ErrorMessage(err.toString());
      }
      res.send({ error_code: 1001, error_message: err.message });
    }
  } catch (e) {
    syzoj.log(e);
    res.send({ error_code: 1002, error_message: "未知错误" });
  }
}

app.post('/problem/:id/like', async (req, res) => {
  await setEvaluate(req, res, 'Like');
});

app.post('/problem/:id/hate', async (req, res) => {
  await setEvaluate(req, res, 'Hate');
});


app.post('/problem/:id/submit', app.multer.fields([{ name: 'answer', maxCount: 1 }]), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    let ip = res.locals.loginIp;
    let curUser = res.locals.user;
    let contest_id = parseInt(req.query.contest_id);
    let practice_id = parseInt(req.query.practice_id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if(problem.type === syzoj.ProblemType.Remote) {
      if(!syzoj.vjBasics.okLang(req.body.language, problem.source)) throw new ErrorMessage('不支持该语言。');
    }
    else if (problem.type !== 'submit-answer' && !syzoj.config.enabled_languages.includes(req.body.language)) throw new ErrorMessage('不支持该语言。');
    if (!curUser) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': syzoj.utils.makeUrl(['problem', id]) }) });
    if(!contest_id && !syzoj.submissionIntervalCheck(curUser.id))  throw new ErrorMessage('提交过于频繁，请稍后');
    let today = new Date();
    today.setHours(0), today.setMinutes(0), today.setSeconds(0), today.setMilliseconds(0);
    let last = await curUser.getlastlogin();
    let ip_location;
    if (!last || last.ip !== ip) {
      ip_location = await syzoj.utils.getLocation(ip);
      rec = await LoginLog.create({
          user_id : curUser.id,
          login_time : new Date(),
          ip : ip,
          ip_location
      });
      rec.save();
      curUser.last_login_time = new Date()
      await curUser.save();
    } else {
      ip_location = last.ip_location;
    }

    let judge_state;
    if (problem.type === 'submit-answer') {
      let File = syzoj.model('file'), path;
      if (!req.files['answer']) {
        // Submited by editor
        try {
          path = await File.zipFiles(JSON.parse(req.body.answer_by_editor));
        } catch (e) {
          throw new ErrorMessage('无法解析提交数据。');
        }
      } else {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');
        path = req.files['answer'][0].path;
      }

      let file = await File.upload(path, 'answer');
      let size = await file.getUnzipSize();

      if (size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');

      if (!file.md5) throw new ErrorMessage('上传答案文件失败。');
      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        submit_ip: ip,
        ip_location,
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: file.md5,
        code_length: size,
        language: null,
        user_id: curUser.id,
        problem_id: id,
        is_public: problem.is_public
      });
    } else {
      let code;
      if (req.files && req.files['answer']) {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_code) throw new ErrorMessage('代码文件太大。');
        code = (await fs.readFile(req.files['answer'][0].path)).toString();
      } else {
        if (Buffer.from(req.body.code).length > syzoj.config.limit.submit_code) throw new ErrorMessage('代码太长。');
        code = req.body.code;
      }

      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        submit_ip: ip,
        ip_location,
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: code,
        code_length: Buffer.from(code).length,
        language: req.body.language,
        user_id: curUser.id,
        problem_id: id,
        is_public: problem.is_public,
        vj_info: problem.type === syzoj.ProblemType.Remote ? {remote: problem.source} : undefined
      });
    }

    let contest, practice, pid = -1;
    if (contest_id) {
      contest = await Contest.findById(contest_id);
      if (!contest) throw new ErrorMessage('无此比赛。');
      if ((!contest.isRunning()) && (!await contest.isSupervisior(curUser))) throw new ErrorMessage('比赛未开始或已结束。');
      let problems_id = await contest.getProblems();

      pid = problems_id.indexOf(id) + 1
      if (pid <= 0) throw new ErrorMessage('无此题目。');
      
      if (contest.max_submissions) {
        const query = JudgeState.createQueryBuilder()
        .where('user_id = :user_id', { user_id: curUser.id })
        .andWhere('type = 1')
        .andWhere('type_info = :contest_id', { contest_id: contest_id })
        .andWhere('problem_id = :problem_id', { problem_id: id });
        const submissionCount = await query.getCount();
        if (submissionCount >= contest.max_submissions)
          throw new ErrorMessage('已达到赛时该题目的提交次数上限。');
      }

      judge_state.type = 1;
      judge_state.type_info = contest_id;

      await judge_state.save();
    } else if (practice_id) {
      practice = await Practice.findById(practice_id);
      if (!practice) throw new ErrorMessage('无此练习赛。');
      if ((!practice.isRunning()) && (!await practice.isSupervisior(curUser))) throw new ErrorMessage('练习赛未开始或已结束。');
      let problems_id = await practice.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');

      judge_state.type = 2;
      judge_state.type_info = practice_id;

      await judge_state.save();
    } else {
      if (!await problem.isAllowedUseBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
      judge_state.type = 0;
      await judge_state.save();
    }
    await judge_state.updateRelatedInfo(true);

    if (problem.type !== 'submit-answer' && syzoj.languages[req.body.language].format) {
      let key = syzoj.utils.getFormattedCodeKey(judge_state.code, req.body.language);
      let formattedCode = await FormattedCode.findOne({
        where: {
          key: key
        }
      });

      if (!formattedCode) {
        let formatted = await CodeFormatter(judge_state.code, syzoj.languages[req.body.language].format);
        if (formatted) {
          formattedCode = await FormattedCode.create({
            key: key,
            code: formatted
          });

          try {
            await formattedCode.save();
          } catch (e) {}
        }
      }
    }

    try {
      judge_state.pending = true;
      judge_state.status = 'Waiting';
      await judge_state.save();
      await Judger.judge(judge_state, problem, contest_id || practice_id ? 3 : 2);
    } catch (err) {
      throw new ErrorMessage(`无法开始评测：${err.toString()}`);
    }

    if (contest && (!await contest.isSupervisior(curUser))) {
      res.redirect(syzoj.utils.makeUrl(['contest', contest_id, 'submissions'], {...req.query, problem_id: pid}));
    } else if (practice && (!await practice.isSupervisior(curUser))) {
      res.redirect(syzoj.utils.makeUrl(['practice', practice_id, 'submissions'], {...req.query, problem_id: pid}));
    } else {
      res.redirect(syzoj.utils.makeUrl(['submission', judge_state.id], {...req.query}));
    }
  } catch (e) {
    syzoj.log(e);
    res.render(req.query.no_jump ? 'error_modal': 'error', {
      err: e
    });
  }
});

app.post('/problem/:id/delete', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let key = req.body.key
    if(!key || syzoj.utils.md5(key) !== "d81df2014e1c31a09dd3849ddf0b6414") throw new ErrorMessage('密码不正确。');
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    if (!await problem.isAllowedManageBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.delete();

    res.redirect(syzoj.utils.makeUrl(['problem']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/testdata', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}

    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let testdata = await problem.listTestdata();
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user)

    res.render('problem_data', {
      problem: problem,
      testdata: testdata,
      testcases: testcases
    });
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/testdata/upload', app.multer.array('file'), async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if(problem.type === syzoj.ProblemType.Remote) throw new ErrorMessage('远程评测的题目不允许测试数据上传。');

    if (req.files) {
      for (let file of req.files) {
        await problem.uploadTestdataSingleFile(file.originalname, file.path, file.size, await res.locals.user.hasPrivilege('manage_problem'));
      }
    }

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'testdata']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/problem/:id/testdata/delete/:filename', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');
    
    await problem.deleteTestdataSingleFile(req.params.filename);

    res.redirect(syzoj.utils.makeUrl(['problem', id, 'testdata']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

function downloadOrRedirect(req, res, filename, sendName) {
  if (syzoj.config.site_for_download) {
    res.redirect(syzoj.config.site_for_download + syzoj.utils.makeUrl(['api', 'v2', 'download', jwt.sign({
      filename: filename,
      sendName: sendName,
      originUrl: syzoj.utils.getCurrentLocation(req)
    }, syzoj.config.session_secret, {
      expiresIn: '2m'
    })]));
  } else {
    res.download(filename, sendName);
  }
}

app.get('/problem/:id/testdata/download/:filename?', async (req, res) => {
	
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    
    // let key = req.query.key
    // if(!key || syzoj.utils.md5(key) !== "d81df2014e1c31a09dd3849ddf0b6414") throw new ErrorMessage('密码不正确。');

    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');

    if (!req.params.filename) {
      if (!await syzoj.utils.isFile(problem.getTestdataArchivePath())) {
        await problem.makeTestdataZip();
      }
    }

    let path = require('path');
    let filename = req.params.filename ? path.join(problem.getTestdataPath(), req.params.filename) : (problem.getTestdataArchivePath());
    if (!await syzoj.utils.isFile(filename)) throw new ErrorMessage('文件不存在。');

    downloadOrRedirect(req, res, filename, path.basename(filename));
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

/*
app.get('/problem/:id/zc/testdata/download/:filename?', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    if (typeof req.params.filename === 'string' && (req.params.filename.includes('../'))) throw new ErrorMessage('您没有权限进行此操作。)');

    if (!req.params.filename) {
      if (!await syzoj.utils.isFile(problem.getTestdataArchivePath())) {
        await problem.makeTestdataZip();
      }
    }

    let path = require('path');
    let filename = req.params.filename ? path.join(problem.getTestdataPath(), req.params.filename) : (problem.getTestdataArchivePath());
    if (!await syzoj.utils.isFile(filename)) throw new ErrorMessage('文件不存在。');

    downloadOrRedirect(req, res, filename, path.basename(filename));
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});
*/

app.get('/problem/:id/download/additional_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');

    // XXX: Reduce duplication (see the '/problem/:id/submit' handler)
    let contest_id = parseInt(req.query.contest_id);
    let practice_id = parseInt(req.query.practice_id);
    if (contest_id) {
      let contest = await Contest.findById(contest_id);
      if (!contest) throw new ErrorMessage('无此比赛。');
      if (!contest.isRunning()) throw new ErrorMessage('比赛未开始或已结束。');
      let problems_id = await contest.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');
    } else if (practice_id) {
      let practice = await Cractice.findById(practice_id);
      if (!practice) throw new ErrorMessage('无此练习赛。');
      if (!practice.isRunning()) throw new ErrorMessage('练习赛未开始或已结束。');
      let problems_id = await practice.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');
    } else {
        if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
        // if (!await problem.isAllowedEditBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
        if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    downloadOrRedirect(req, res, problem.additional_file.getPath(), `additional_file_${id}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.get('/problem/:id/statistics/:type', async (req, res) => {
  try {
    if(!res.locals.user){throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});}
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!await problem.isAllowedUseBy_contest(res.locals.user) && !await problem.isAllowedUseBy_practice(res.locals.user) ) throw new ErrorMessage('您没有权限进行此操作。');

    let count = await problem.countStatistics(req.params.type);
    if (count === null) throw new ErrorMessage('无此统计类型。');

    let paginate = syzoj.utils.paginate(count, req.query.page, syzoj.config.page.problem_statistics);
    let statistics = await problem.getStatistics(req.params.type, paginate);

    await statistics.judge_state.forEachAsync(async x => x.loadRelationships());

    res.render('statistics', {
      statistics: statistics,
      paginate: paginate,
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

/*
app.post('/problem/:id/custom-test', app.multer.fields([{ name: 'code_upload', maxCount: 1 }, { name: 'input_file', maxCount: 1 }]), async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (!res.locals.user) throw new ErrorMessage('请登录后继续。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': syzoj.utils.makeUrl(['problem', id]) }) });
    if (!await problem.isAllowedUseBy(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');

    let filepath;
    if (req.files['input_file']) {
      if (req.files['input_file'][0].size > syzoj.config.limit.custom_test_input) throw new ErrorMessage('输入数据过长。');
      filepath = req.files['input_file'][0].path;
    } else {
      if (req.body.input_file_textarea.length > syzoj.config.limit.custom_test_input) throw new ErrorMessage('输入数据过长。');
      filepath = await require('tmp-promise').tmpName({ template: '/tmp/tmp-XXXXXX' });
      await require('fs-extra').writeFileAsync(filepath, req.body.input_file_textarea);
    }

    let code;
    if (req.files['code_upload']) {
      if (req.files['code_upload'][0].size > syzoj.config.limit.submit_code) throw new ErrorMessage('代码过长。');
      code = (await require('fs-extra').readFileAsync(req.files['code_upload'][0].path)).toString();
    } else {
      if (Buffer.from(req.body.code).length > syzoj.config.limit.submit_code) throw new ErrorMessage('代码过长。');
      code = req.body.code;
    }

    let custom_test = await CustomTest.create({
      input_filepath: filepath,
      code: code,
      language: req.body.language,
      user_id: res.locals.user.id,
      problem_id: id
    });

    await custom_test.save();

    let waiting_judge = await WaitingJudge.create({
      judge_id: custom_test.id,
      priority: 3,
      type: 'custom_test'
    });

    await waiting_judge.save();

    res.send({
      id: custom_test.id
    });
  } catch (e) {
    syzoj.log(e);
    res.send({
      err: e
    });
  }
});
*/


app.get('/problem/:id/contest_info', async (req, res) => {
  try {
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = req.params.id
    let contests = await Contest.queryAll(Contest.createQueryBuilder().where(`problems regexp '^(.*[^0-9])?${id}([^0-9].*)?$'`))
    contests.sort((a, b) => b.start_time - a.start_time)
    contests.forEach(c => c.format_start_time = syzoj.utils.formatDate(c.start_time))
    res.send({contests})
  } catch (e) {
    res.send({error: e})
  }
});

app.get('/problem/:id/note', async (req, res) => {
  try {
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = req.params.id
    let problem_note = await ProblemNote.findOne({problem_id: id})
    if(!problem_note) res.send({note: '', note_html: ''});
    else {
      let note_html = await syzoj.utils.markdown(problem_note.note)
      res.send({note: problem_note.note, note_html})
    }
  } catch (e) {
    res.send({error: e})
  }
});

app.post('/problem/:id/note/update',  async (req, res) => {
  try {
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.params.id)
    let action = parseInt(req.body.action)
    if (isNaN(id) || isNaN(action)) throw "参数错误"
    if(action === 0) {
      let problem_note = await ProblemNote.findOne({problem_id: id})
      if(!problem_note) {
        problem_note = await ProblemNote.create({
          problem_id: id,
          note: req.body.note
        })
      } else problem_note.note = req.body.note
      await problem_note.save()
      res.send({note_html:  await syzoj.utils.markdown(problem_note.note)})
    } else if(action === 1) {
      let problem_note = await ProblemNote.findOne({problem_id: id})
      if(problem_note) await problem_note.destroy()
      res.send({msg: "ok"})
    } else throw "参数错误"
  } catch (e) {
    res.send({error: e})
  }
});

app.post('/problem/:id/code/test', app.multer.any(), async (req, res) => {
  let tmp_dir = syzoj.utils.resolvePath(syzoj.config.upload_dir, 'tmp') + "/" + randomstring.generate(5) + "/"
  try {
    if(!res.locals.user) throw '您没有权限进行此操作。';
    let problem = await Problem.findById(parseInt(req.params.id))
    if(!problem) throw "无此题目。"

    if(!syzoj.submissionIntervalCheck(res.locals.user.id))  throw '提交过于频繁'
    if(!(req.files && req.files[0] && req.files[0].path)) throw "没有上传输入文件";

    let time_limit =  problem.time_limit || 5000
    let memory_limit = problem.memory_limit || 1024

    let src = req.body.src;
    if(!src || src.length < 15) throw "测试代码太短"
    let lang = req.body.lang;

    // console.log(req.files[0].path)
    await fs.mkdirp(tmp_dir)
    src_path = tmp_dir + "main.cpp";
    await fs.writeFile(src_path, src)

    input_path = tmp_dir + (problem.file_io ? problem.file_io_input_name : "test.in");
    await fs.writeFile(input_path, await fs.readFile(req.files[0].path))

    output_path = tmp_dir + (problem.file_io ? problem.file_io_output_name : "test.out");


    let judge_result = await new Promise((resolve, reject) => {
      child_process.exec(`./bin/test_runner -s ${src_path} -l ${lang} -t ${time_limit} -m  ${memory_limit} ${problem.memory_limit} -I ${input_path} -O ${output_path} -R ${problem.file_io ? 0 : 1}`, function(error, stdout, stderr) {
        resolve(stdout)
      })
    });

    judge_result = JSON.parse(judge_result.replace(/\n/g,"<br>"))
    if(await fs.exists(output_path)) {
      judge_result.output =  await new Promise((resolve, reject) => {
        fs.open(output_path, 'r', function(status, fd) {
          if(status) {
            resolve(null)
            return
          }
          const contentLength = 128
          var buffer = Buffer.alloc(contentLength)
          fs.read(fd, buffer, 0, contentLength, 0, function(err, num) {
            if(err) {
              resolve(null)
            } else {
              let data = buffer.toString('utf-8', 0, num) + (num >= contentLength ? "..." : "")
              resolve(data)
            }
          });
        })
      })
    }
    res.send(judge_result)
  } catch (e) {
    res.send({not_allowed_error: e})
  } finally {
    fs.remove(tmp_dir, () => {})
    if (req.files && req.files[0] && req.files[0].path) fs.rm(req.files[0].path, () => {});
  }
});


app.get('/problem/:id/summaries',  async (req, res) => {
  try {
    if(!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
    let id = parseInt(req.params.id)
    let summaries = await ProblemSummary.queryAll(ProblemSummary.createQueryBuilder().where(`problem_id = ${id}`))
    let names = summaries.map(s =>  s.username)

    let users = names.length === 0 ? [] :  await User.queryAll(User.createQueryBuilder().where(`username in (${names.map(n => "'" + n + "'").join(',')})`))
    let mp = new Map()
    users.forEach(u => mp.set(u.username, {username: u.username, nickname: u.nickname, id: u.id}))

    for(let s of summaries) {
      s.user = mp.get(s.username)
      if(!s.user) s.user = {username: '未知', nickname: '未知', id: 0}
      s.format_post_time = syzoj.utils.formatDate(s.post_time)
      s.summary = await syzoj.utils.markdown(s.summary)
    }
    res.send({summaries})
  } catch (e) {
    res.send({error: e})
  }
});

app.post('/problem/change_creator', async (req, res) => {
  try {
    // 验证用户登录和管理员权限
    if(!res.locals.user){
      throw new ErrorMessage('请登录后继续。',{'登录': syzoj.utils.makeUrl(['login'])});
    }
    if (!res.locals.user.is_admin) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    // 获取用户 ID 和题目 ID 列表
    let user_id = parseInt(req.body.user_id);
    let problem_ids = JSON.parse(req.body.problem_ids); // 假设这是一个数组

    // 验证用户存在
    let user = await User.findById(user_id);
    if (!user) {
      throw new ErrorMessage('无此用户。');
    }

    // 循环处理每个题目
    await Promise.all(problem_ids.map(async (id) => {
      let problem = await Problem.findById(parseInt(id));
      if (!problem) return;
    
      // 更改题目的创建者
      problem.user_id = user_id;
      await problem.save();
    }));

    // 重定向或返回成功响应
    res.redirect(syzoj.utils.makeUrl(['admin', 'change_problem_creator']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
