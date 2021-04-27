const AWS = require('aws-sdk');
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
    console.log('heythisischris init');
    event.body ? event.body = JSON.parse(event.body) : event.body = {};

    if (event.path === '/github') {
        let graphql = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            body: JSON.stringify({
                query: `{${['place4pals', 'productabot', 'heythisischris'].map(obj => `
  ${obj}: search(query: "org:${obj}", type: REPOSITORY, last: 10) {
    nodes {
      ... on Repository {
        name
        url
        refs(refPrefix: "refs/heads/", first: 10) {
          edges {
            node {
              ... on Ref {
                name
                target {
                  ... on Commit {
                    history(first: 100, author: {emails:["chris@heythisischris.com","thisischrisaitken@gmail.com","caitken@teckpert.com"]}) {
                      edges {
                        node {
                          ... on Commit {
                            message
                            commitUrl
                            committedDate
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
}`).join('')}}`
            }),
            headers: { Authorization: 'Basic ' + Buffer.from('heythisischris:' + process.env.github).toString('base64') }
        });
        graphql = await graphql.json();
        let responseArray = [];
        for (let org of Object.values(graphql.data)) {
            for (let repo of org.nodes) {
                for (let branch of repo.refs.edges) {
                    responseArray = responseArray.concat(branch.node.target.history.edges.map(obj => {
                        return {
                            date: obj.node.committedDate,
                            repo: repo.name,
                            repoUrl: repo.url,
                            branch: branch.node.name,
                            commit: obj.node.message,
                            commitUrl: obj.node.commitUrl
                        };
                    }));
                }
            }
        }
        responseArray.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return { statusCode: 200, body: JSON.stringify(responseArray.splice(0, 30)), headers: { 'Access-Control-Allow-Origin': '*' } };
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
        AWS.config.update({ region: 'us-east-1' });
        let response = await new AWS.SES().sendEmail({
            Destination: {
                ToAddresses: ['chris@heythisischris.com']
            },
            Message: {
                Body: {
                    Html: { Data: event.body.message },
                    Text: { Data: event.body.message }
                },
                Subject: {
                    Data: `${event.body.name} contacted you from ${event.body.email}`
                }
            },
            Source: 'noreply@heythisischris.com',
            ReplyToAddresses: ['noreply@heythisischris.com'],
        }).promise();
        console.log(response);

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
