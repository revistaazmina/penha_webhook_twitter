require('dotenv').config()

const redis = require('../storage/redis');
const twitter = require('../webservices/twitter');
const analytics_api = require('../webservices/analytics');
const { json } = require('body-parser');

async function process_queue() {
    const ttl = 3600000;

    const lock = await redis.setnx('timeout_started_at', (Date.now() / 1000));
    console.log(lock);
    if (lock === 1) {
        await redis.pexpire('timeout_started_at', ttl);

        console.info('Buscando keys no redis');
        const keys = await redis.keys('*');

        let json_config = await redis.get('json_config');
        json_config = JSON.parse(json_config);

        const config_timeout_seconds = json_config.timeout_seconds;
        const config_timeout_msg = json_config.timeout_message;

        keys.forEach(async key => {
            if (key === 'json_config') {
                return;
            }

            console.info('Buscando stash para twitter_id: ' + key);
            let stash = await redis.get(key);
            stash = JSON.parse(stash);

            const last_msg_epoch = stash.last_msg_epoch;
            const seconds_since_last_msg = (Date.now() / 1000) - last_msg_epoch;

            if (seconds_since_last_msg >= config_timeout_seconds) {
                console.info('É hora de dar timeout');

                const twitter_user_id = key;

                await twitter.send_dm(twitter_user_id, config_timeout_msg);
                await analytics_api.timeout(stash.last_analytics_id);

                const new_stash = {
                    last_conversa_finished_at: (Date.now() / 1000)
                };
                return await redis.set(twitter_user_id, JSON.stringify(new_stash));
            }
            else {
                console.info('ainda não é hora de dar timeout');
                return 1;
            }
        });

        console.info('Deletando key timeout_started_at no redis');
        await redis.del('timeout_started_at');
        process.exit(1);

        return 1;
    }
    else {
        console.info('Já há uma execução para o script de timeout');
        process.exit(1);
        return 1;
    }
}

process_queue();

