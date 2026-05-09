const { createApp } = Vue;
createApp({
  data() {
    return {
      currentUser: { id: null, display_name: '', status: 'online', avatar: 'default', status_message: '' },
      contacts: [], friendRequests: [], activeChat: null, activeMessages: [],
      searchQuery: '', searchResults: [], showAddContact: false,
      messageText: '', socket: null,
      activeTab: 'contacts',
      showProfileModal: false,
      editStatusMessage: '', editAvatar: 'default', editStatus: 'online',
      newRequestAlert: false,
      showEmojiPicker: false,
      toastMsg: '', toastType: '', toastTimer: null,
      avatarMap: { default: '😊', cool: '😎', cat: '🐱', dog: '🐶', angel: '😇', devil: '😈', nerd: '🤓', love: '😍' },
      emojis: ['😊', '😎', '😂', '😍', '🤔', '😅', '👍', '❤️', '🔥', '😭', '🎉', '💯', '😴', '🙏', '😤', '🤣', '😏', '🤗', '😬', '🙈']
    };
  },
  computed: {
    onlineContacts() { return this.contacts.filter(c => c.status !== 'offline'); },
    offlineContacts() { return this.contacts.filter(c => c.status === 'offline'); }
  },
  methods: {
    getAvatarEmoji(k) { return this.avatarMap[k] || '😊'; },

    formatTime(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    },

    showToast(msg, type = 'info') {
      this.toastMsg = msg; this.toastType = type;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toastMsg = ''; }, 3000);
    },

    async checkAuth() {
      try {
        const res = await $.get('/api/auth/me');
        this.currentUser = { ...this.currentUser, ...res.user };
        this.editStatusMessage = this.currentUser.status_message || '';
        this.editAvatar = this.currentUser.avatar || 'default';
        this.editStatus = this.currentUser.status || 'online';
        this.initSocket();
        this.loadData();
      } catch (e) { window.location.href = '/'; }
    },

    initSocket() {
      this.socket = io();

      this.socket.on('private_message', (m) => {
        if (this.activeChat && m.sender_id === this.activeChat.id) {
          this.activeMessages.push(m);
          this.$nextTick(() => this.scrollToBottom());
        }
      });

      // message_sent = confirmare de la server, ignoram (am adaugat deja local)
      this.socket.on('message_sent', () => { });

      this.socket.on('status_change', (data) => {
        const c = this.contacts.find(x => x.id === data.userId);
        if (c) { c.status = data.status; if (data.statusMessage !== undefined) c.status_message = data.statusMessage; }
        if (this.activeChat && this.activeChat.id === data.userId) this.activeChat.status = data.status;
        if (data.userId === this.currentUser.id) this.currentUser.status = data.status;
      });

      this.socket.on('avatar_change', (data) => {
        const c = this.contacts.find(x => x.id === data.userId);
        if (c) c.avatar = data.avatar;
        if (this.activeChat && this.activeChat.id === data.userId) this.activeChat.avatar = data.avatar;
      });

      this.socket.on('friend_request', (sender) => {
        if (!this.friendRequests.find(r => r.id === sender.id)) this.friendRequests.push(sender);
        this.newRequestAlert = true;
        this.showToast(`📨 Cerere noua de la ${sender.display_name}!`, 'success');
      });

      this.socket.on('friend_accepted', () => {
        this.loadData();
        this.showToast('✅ Cerere acceptata!', 'success');
      });
    },

    async loadData() {
      const c = await $.get('/api/chat/contacts'); this.contacts = c.contacts;
      const r = await $.get('/api/chat/requests'); this.friendRequests = r.requests;
    },

    async searchUsers() {
      if (this.searchQuery.length < 2) { this.searchResults = []; return; }
      const res = await $.get('/api/chat/search?q=' + encodeURIComponent(this.searchQuery));
      this.searchResults = res.users;
    },

    async addContact(u) {
      try {
        await $.post('/api/chat/contacts/add', { username: u.username });
        this.showAddContact = false; this.searchQuery = ''; this.searchResults = [];
        this.showToast(`📨 Cerere trimisa catre ${u.display_name}!`, 'success');
      } catch (err) { this.showToast(err.responseJSON?.error || 'Eroare', 'error'); }
    },

    async acceptFriend(id) {
      await $.post('/api/chat/contacts/accept', { contactId: id });
      this.friendRequests = this.friendRequests.filter(r => r.id !== id);
      await this.loadData();
    },

    async rejectFriend(id) {
      await $.post('/api/chat/contacts/reject', { contactId: id });
      this.friendRequests = this.friendRequests.filter(r => r.id !== id);
    },

    switchTab(tab) { this.activeTab = tab; if (tab === 'requests') this.newRequestAlert = false; },

    async openChat(c) {
      this.activeChat = c;
      const res = await $.get('/api/chat/messages/' + c.id);
      this.activeMessages = res.messages;
      this.$nextTick(() => this.scrollToBottom());
    },

    scrollToBottom() { if (this.$refs.msgs) this.$refs.msgs.scrollTop = this.$refs.msgs.scrollHeight; },

    sendMessage() {
      if (!this.messageText.trim() || !this.activeChat) return;
      const msg = {
        id: Date.now(), sender_id: this.currentUser.id,
        receiver_id: this.activeChat.id, content: this.messageText,
        created_at: new Date().toISOString()
      };
      this.activeMessages.push(msg);
      this.socket.emit('private_message', { toUserId: this.activeChat.id, content: this.messageText });
      this.messageText = '';
      this.$nextTick(() => this.scrollToBottom());
    },

    openProfileModal() {
      this.editStatusMessage = this.currentUser.status_message || '';
      this.editAvatar = this.currentUser.avatar || 'default';
      this.editStatus = this.currentUser.status || 'online';
      this.showProfileModal = true;
    },

    saveProfile() {
      this.currentUser.status_message = this.editStatusMessage;
      this.currentUser.avatar = this.editAvatar;
      this.currentUser.status = this.editStatus;
      this.socket.emit('change_status', { status: this.editStatus, statusMessage: this.editStatusMessage });
      this.socket.emit('change_avatar', { avatar: this.editAvatar });
      this.showProfileModal = false;
      this.showToast('✅ Profil salvat!', 'success');
    },

    insertEmoji(e) { this.messageText += e; this.showEmojiPicker = false; this.$refs.textarea?.focus(); },

    doLogout() { $.post('/api/auth/logout').then(() => window.location.href = '/'); }
  },
  mounted() { this.checkAuth(); setInterval(this.loadData, 10000); }
}).mount('#app');