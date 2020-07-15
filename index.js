const { Pool } = require('pg');
const poolConfig = {
    user: process.env.user,
    host: process.env.host,
    database: process.env.database,
    password: process.env.password,
    port: process.env.port
};
const Parser = require('rss-parser');
const parser = new Parser();
const fetch = require('node-fetch');

exports.handler = async(event) => {
    if (event.body) {
        event.body = JSON.parse(event.body);
    }

    if (event.path === '/github') {
        let headers = {
            method: 'GET',
            headers: { Authorization: 'Basic ' + Buffer.from('heythisischris:'+process.env.github).toString('base64') }
        };
        let repos = await fetch('https://api.github.com/users/heythisischris/repos', headers);
        repos = await repos.json();
        console.log(repos);
        let responseArray = [];
        for (let repo of repos) {
            let repoData = await fetch(repo.commits_url.slice(0, -6), headers);
            repoData = await repoData.json();
            responseArray = responseArray.concat(repoData.map(obj => { return { date: obj.commit.author.date, repo: repo.name, repoUrl: repo.html_url, commit: obj.commit.message, commitUrl: obj.html_url } }));
        }
        responseArray.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { statusCode: 200, body: JSON.stringify(responseArray.splice(0,25)), headers: { 'Access-Control-Allow-Origin': '*' } };
    }
    else if (event.path === '/feed') {
        let feed = await parser.parseURL('https://blog.heythisischris.com/feed');

        let pool = new Pool(poolConfig);
        for (let obj of feed.items) {
            let response = await pool.query('SELECT COUNT(*) as count FROM comments WHERE post_guid = $1', [obj.guid]);
            obj.commentCount = response.rows[0].count;
        }
        pool.end();

        return { statusCode: 200, body: JSON.stringify(feed.items), headers: { 'Access-Control-Allow-Origin': '*' } };
    }
    else if (event.path === '/contact') {
        let sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.sendgrid);
        const msg = {
            to: 'chris@heythisischris.com',
            from: 'noreply@heythisischris.com',
            subject: `${event.body.name} contacted you from ${event.body.email}`,
            text: event.body.message,
            html: event.body.message
        };
        await sgMail.send(msg);

        return { statusCode: 200, body: JSON.stringify('success'), headers: { 'Access-Control-Allow-Origin': '*' } };
    }
    else if (event.path === '/comments') {
        //do code here to connect to that database of yours
        let response;
        let pool = new Pool(poolConfig);
        if (event.httpMethod === 'GET') {
            response = await pool.query('SELECT * FROM comments WHERE post_guid = $1', [event.queryStringParameters.post_guid]);
            for (let obj of response.rows) {
                if (obj.ip_address === event.requestContext.identity.sourceIp) {
                    obj.canDelete = true;
                }
            }
        }
        else if (event.httpMethod === 'POST') {
            response = await pool.query('INSERT INTO comments(ip_address, name, comment, post_guid ) VALUES($1, $2, $3, $4) RETURNING *', [event.requestContext.identity.sourceIp, event.body.name.substr(0, 10), event.body.comment.substr(0, 200), event.body.post_guid]);
        }
        else if (event.httpMethod === 'DELETE') {
            response = await pool.query('DELETE FROM comments WHERE id = $1 AND ip_address = $2', [event.body.id, event.requestContext.identity.sourceIp]);
        }
        pool.end();
        return { statusCode: 200, body: JSON.stringify(response.rows), headers: { 'Access-Control-Allow-Origin': '*' } };
    }
    else {
        return { statusCode: 200, body: 'whatcha lookin for?', headers: { 'Access-Control-Allow-Origin': '*' } };
    }
};
