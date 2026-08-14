Page({
  data: {
    checkpoints: Object.freeze([
      "客户端不保存服务端凭证",
      "AI 只生成待核对提案",
      "用户确认后才能写入",
    ]),
  },

  onReady() {
    const query = wx.createSelectorQuery().in(this);
    query
      .select("#contractCanvas")
      .fields({ node: true, size: true })
      .exec((result) => {
        const target = result && result[0];
        if (!target || !target.node || !target.width || !target.height) return;

        const windowInfo = typeof wx.getWindowInfo === "function"
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
        const dpr = Math.max(1, windowInfo.pixelRatio || 1);
        const canvas = target.node;
        const context = canvas.getContext("2d");
        canvas.width = target.width * dpr;
        canvas.height = target.height * dpr;
        context.scale(dpr, dpr);
        this.drawContractLines(context, target.width, target.height);
      });
  },

  drawContractLines(context, width, height) {
    const line = (color, offset) => {
      context.beginPath();
      context.moveTo(10, height * 0.68 + offset);
      context.bezierCurveTo(
        width * 0.32,
        height * 0.7 + offset,
        width * 0.55,
        height * 0.48 + offset,
        width * 0.74,
        height * 0.44 + offset,
      );
      context.lineTo(width - 10, height * 0.22 + offset);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 4;
      context.strokeStyle = color;
      context.stroke();
    };

    line("#c7f348", 0);
    line("#8271d8", 9);
  },
});

