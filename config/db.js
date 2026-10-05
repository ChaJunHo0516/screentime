// config/db.js
// MySQL 커넥션 풀. 접속 정보는 환경변수(.env)에서만 읽는다. (코드에 credential 작성 금지)
const mysql = require('mysql2/promise');
const env = require('./env');

env.validate();

const connection = env.db.socketPath
    ? { socketPath: env.db.socketPath }               // Cloud SQL (Phase 12)
    : { host: env.db.host, port: env.db.port };

const pool = mysql.createPool({
    ...connection,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

// 서버 켜질 때 DB 연결 테스트 (접속 정보는 출력하지 않는다)
if (env.nodeEnv !== 'test') {
    pool.getConnection()
        .then(conn => {
            console.log(' MySQL 데이터베이스가 연결되었습니다!');
            conn.release();
        })
        .catch(err => {
            console.error(' MySQL 연결 실패! DB가 켜져있는지, .env 의 DB_* 값이 맞는지 확인하세요.', err.code || err.message);
        });
}

module.exports = pool;
