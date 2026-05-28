const request = require('supertest');
const { expect } = require('chai');
const server = require('../Server/server.js');
describe(' Modulul Autentificare (Auth)', function() {
    let testUser = { username: 'auth_user_' + Date.now(), password: 'password123', email: `auth_${Date.now()}@yahoo.com` };
    let token = '';

after((done) => { if (server && server.close) server.close(done); else done(); });
    it('Ar trebui sa inregistreze un utilizator nou', async () => {
        const res = await request(server).post('/api/auth/register').send(testUser);
        expect(res.statusCode).to.equal(200);
    });

    it('[Eroare] Ar trebui sa respinga login-ul cu parola gresita', async () => {
        const res = await request(server).post('/api/auth/login').send({ username: testUser.username, password: 'wrong' });
        expect(res.statusCode).to.equal(401);
    });

    it('Ar trebui sa autentifice utilizatorul si sa returneze un cookie', async () => {
        const res = await request(server).post('/api/auth/login').send(testUser);
        expect(res.statusCode).to.equal(200);
        token = res.headers['set-cookie'][0];
    });

    it('Ar trebui sa preia datele profilului folosind token-ul', async () => {
        const res = await request(server).get('/api/auth/me').set('Cookie', token);
        expect(res.statusCode).to.equal(200);
        expect(res.body.user.username).to.equal(testUser.username);
    });
});