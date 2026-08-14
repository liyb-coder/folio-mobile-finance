Component({
  data: {
    selected: 0,
    tabs: [
      { pagePath: "/pages/overview/index", text: "总览", icon: "/assets/icons/house.png" },
      { pagePath: "/pages/assets/index", text: "资产", icon: "/assets/icons/wallet.png" },
      { pagePath: "/pages/capture/index", text: "记一笔", icon: "/assets/icons/microphone-fill.png", capture: true },
      { pagePath: "/pages/reminders/index", text: "提醒", icon: "/assets/icons/calendar.png" },
      { pagePath: "/pages/assistant/index", text: "AI 管家", icon: "/assets/icons/sparkle.png" }
    ]
  },
  methods: {
    switchTab(event) {
      wx.switchTab({ url: event.currentTarget.dataset.path });
    }
  }
});
