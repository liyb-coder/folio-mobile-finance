Component({
  data: {
    menuOpen: false
  },
  methods: {
    toggleMenu() {
      this.setData({ menuOpen: !this.data.menuOpen });
    },
    openPage(event) {
      const url = event.currentTarget.dataset.url;
      this.setData({ menuOpen: false });
      if (url) wx.navigateTo({ url });
    }
  }
});
