const { createApp } = Vue;
createApp({
  data() {
    return {
      currentUser: { id: null, display_name: '', status: 'online', avatar: 'default' },
      contacts: [], friendRequests: [], activeChat: null, activeMessages: [],
      searchQuery: '', searchResults: [], showAddContact: false,
      messageText: '', socket: null
    };
  },
  computed: {
    onlineContacts() { return this.contacts.filter(c => c.status !== 'offline'); },
    offlineContacts() { return this.contacts.filter(c => c.status === 'offline'); }
  },
  methods: {
    getAvatarEmoji(k) { const m = { default: '😊', cool: '😎', cat: '🐱', dog: '🐶' }; return m[k] || '😊'; },
    async checkAuth() {
      try {
        const res = await $.get('/api/auth/me');
        this.currentUser = res.user;
        this.socket = io();
        this.socket.on('private_message', (m) => {
          if (this.activeChat && (m.sender_id === this.activeChat.id || m.receiver_id === this.activeChat.id)) {
            this.activeMessages.push(m);
            this.$nextTick(() => { this.$refs.msgs.scrollTop = this.$refs.msgs.scrollHeight; });
          } else { this.loadData(); }
        });
        this.socket.on('status_change', () => this.loadData());
        this.loadData();
      } catch (e) { window.location.href = '/'; }
    },
    async loadData() {
      const c = await $.get('/api/chat/contacts'); this.contacts = c.contacts;
      const r = await $.get('/api/chat/requests'); this.friendRequests = r.requests;
    },
    async searchUsers() {
      if (this.searchQuery.length < 2) return;
      const res = await $.get('/api/chat/search?q=' + this.searchQuery);
      this.searchResults = res.users;
    },
    async addContact(u) {
      await $.post('/api/chat/contacts/add', { username: u.username });
      this.showAddContact = false; this.searchQuery = '';
    },
    async acceptFriend(id) {
      await $.post('/api/chat/contacts/accept', { contactId: id });
      this.loadData();
    },
    async openChat(c) {
      this.activeChat = c;
      const res = await $.get('/api/chat/messages/' + c.id);
      this.activeMessages = res.messages;
    },
    sendMessage() {
      if (!this.messageText.trim()) return;
      this.socket.emit('private_message', { toUserId: this.activeChat.id, content: this.messageText });
      this.activeMessages.push({ sender_id: this.currentUser.id, content: this.messageText });
      this.messageText = '';
    },
    updateStatus() { this.socket.emit('change_status', { status: this.currentUser.status, statusMessage: '' }); },
    doLogout() { $.post('/api/auth/logout').then(() => window.location.href = '/'); }
  },
  mounted() { this.checkAuth(); setInterval(this.loadData, 5000); }
}).mount('#app');