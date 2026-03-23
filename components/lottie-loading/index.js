const lottie = require('lottie-miniprogram');
const loadingAnimationData = require('../../assets/images/loading.js');

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(next) {
        this.toggleAnimation(!!next);
      },
    },
    sizeRpx: {
      type: Number,
      value: 420,
    },
  },

  data: {},

  lifetimes: {
    ready() {
      if (this.properties.visible) {
        this.initAnimation();
      }
    },
    detached() {
      this.destroyAnimation();
    },
  },

  methods: {
    initAnimation() {
      if (this._animation) {
        this.destroyAnimation();
      }
      const query = wx.createSelectorQuery().in(this);
      query
        .select('#lottie-loading-canvas')
        .node()
        .exec((res) => {
          const canvasNode = res && res[0] ? res[0].node : null;
          if (!canvasNode) return;

          const dpr =
            (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) ||
            wx.getSystemInfoSync().pixelRatio ||
            1;
          const sizePx = 210;
          canvasNode.width = sizePx * dpr;
          canvasNode.height = sizePx * dpr;

          const ctx = canvasNode.getContext('2d');
          if (!ctx) return;
          ctx.scale(dpr, dpr);
          this._ctx = ctx;
          this._canvasNode = canvasNode;
          lottie.setup(canvasNode);

          this._animation = lottie.loadAnimation({
            renderer: 'canvas',
            loop: true,
            autoplay: true,
            animationData: loadingAnimationData,
            rendererSettings: {
              context: ctx,
              clearCanvas: true,
            },
          });
        });
    },

    toggleAnimation(visible) {
      if (visible) {
        // 每次显示都重建实例，避免 canvas 复用导致静帧
        this.initAnimation();
      } else {
        this.destroyAnimation();
      }
    },

    destroyAnimation() {
      if (!this._animation) return;
      try {
        this._animation.destroy();
      } catch (e) {
        console.warn('destroy lottie loading failed', e);
      }
      this._animation = null;
      if (this._ctx && this._canvasNode) {
        try {
          const sizePx = 210;
          this._ctx.clearRect(0, 0, sizePx, sizePx);
        } catch (e) {
          console.warn('clear lottie canvas failed', e);
        }
      }
      this._ctx = null;
      this._canvasNode = null;
    },
  },
});
