// config/db.js
const mysql = require('mysql2/promise'); // 비동기 처리를 위해 promise 버전 사용!

// MySQL 커넥션 풀 생성 (요청이 올 때마다 연결을 빌려주고 돌려받는 효율적인 방식)
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'rootroot', //  본인의 MySQL 비밀번호로 
    database: 'nudgeai',      // 데이터베이스 이름
    waitForConnections: true,
    connectionLimit: 10,      // 동시에 처리할 수 있는 최대 연결 수
    queueLimit: 0
});

// 서버 켜질 때 DB 연결 잘 되는지 테스트
pool.getConnection()
    .then(conn => {
        console.log(' MySQL 데이터베이스가 연결되었습니다!');
        conn.release(); // 테스트 끝났으니 연결 반납
    })
    .catch(err => {
        console.error(' MySQL 연결 실패! DB가 켜져있는지, 비밀번호가 맞는지 확인하세요.', err.message);
    });

module.exports = pool;
