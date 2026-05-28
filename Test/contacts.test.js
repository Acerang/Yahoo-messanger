const request = require('supertest');
const { expect } = require('chai');
const server = require('../Server/server.js');

describe('👥 Modulul Contacte si Prietenii', function() {
    let user1 = { username: 'c1_' + Date.now(), password: '123', email: `c1_${Date.now()}@test.com` };
    let user2 = { username: 'c2_' + Date.now(), password: '123', email: `c2_${Date.now()}@test.com` };
    let token1 = '', token2 = '', user1Id;

    before(async () => {
        await request(server).post('/api/auth/register').send(user1);
        await request(server).post('/api/auth/register').send(user2);
        
        let res1 = await request(server).post('/api/auth/login').send(user1);
        token1 = res1.headers['set-cookie'][0];
        
        let res2 = await request(server).post('/api/auth/login').send(user2);
        token2 = res2.headers['set-cookie'][0];

        let meRes = await request(server).get('/api/auth/me').set('Cookie', token1);
        user1Id = meRes.body.user.id;
    });

    it('[Eroare] Nu ar trebui sa te lase sa te adaugi pe tine', async () => {
        const res = await request(server).post('/api/chat/contacts/add').set('Cookie', token1).send({ username: user1.username });
        expect(res.statusCode).to.equal(400);
    });

    it('User1 ar trebui sa trimita o cerere catre User2', async () => {
        const res = await request(server).post('/api/chat/contacts/add').set('Cookie', token1).send({ username: user2.username });
        expect(res.statusCode).to.equal(200);
    });

    it('User2 ar trebui sa accepte cererea', async () => {
        const res = await request(server).post('/api/chat/contacts/accept').set('Cookie', token2).send({ contactId: user1Id });
        expect(res.statusCode).to.equal(200);
    });
});