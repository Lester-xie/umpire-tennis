// pages/components/desc-container/desc-container.js
Component({
  data: {
    descWidth: 0,
    descHeight: 0,
    tennisX: 0,
    tennisY: 0,
    tennisRotate: 0, // 旋转角度
  },

  methods: {
    // 初始化网球动画
    initTennisAnimation() {
      const descWidth = this.data.descWidth;
      const descHeight = this.data.descHeight;
      
      if (!descWidth || !descHeight || descWidth <= 0 || descHeight <= 0) {
        // 如果尺寸未准备好，延迟初始化
        setTimeout(() => {
          this.initTennisAnimation();
        }, 100);
        return;
      }
      
      // 网球图标尺寸
      const tennisSize = 30;
      
      // 随机初始位置（在 desc 区域内）
      const initialX = Math.max(0, Math.random() * (descWidth - tennisSize));
      const initialY = Math.max(0, Math.random() * (descHeight - tennisSize));
      
      // 随机初始速度方向（确保速度不为0，范围在 -3 到 3 之间）
      let speedX = (Math.random() - 0.5) * 6;
      let speedY = (Math.random() - 0.5) * 6;
      // 确保速度不为0
      if (Math.abs(speedX) < 1) speedX = speedX > 0 ? 1 : -1;
      if (Math.abs(speedY) < 1) speedY = speedY > 0 ? 1 : -1;
      
      // 随机初始旋转速度（度/帧），根据移动速度计算旋转速度
      const rotateSpeed = (Math.abs(speedX) + Math.abs(speedY)) * 2; // 根据移动速度计算旋转速度
      
      this.setData({
        tennisX: initialX,
        tennisY: initialY,
        tennisRotate: 0,
      });
      
      // 保存动画相关数据
      this.tennisAnimation = {
        x: initialX,
        y: initialY,
        speedX: speedX,
        speedY: speedY,
        rotate: 0, // 当前旋转角度
        rotateSpeed: rotateSpeed, // 旋转速度
        size: tennisSize,
        containerWidth: descWidth,
        containerHeight: descHeight,
      };
      
      // 启动动画
      this.startTennisAnimation();
    },
    // 启动网球跳动动画
    startTennisAnimation() {
      if (this.animationTimer) {
        clearTimeout(this.animationTimer);
      }
      
      const animate = () => {
        if (!this.tennisAnimation) {
          return;
        }
        
        const { x, y, speedX, speedY, size, containerWidth, containerHeight } = this.tennisAnimation;
        
        // 计算新位置
        let newX = x + speedX;
        let newY = y + speedY;
        let newSpeedX = speedX;
        let newSpeedY = speedY;
        
        // 检测左右边界碰撞
        if (newX <= 0) {
          newSpeedX = -newSpeedX;
          newX = 0;
        } else if (newX >= containerWidth - size) {
          newSpeedX = -newSpeedX;
          newX = containerWidth - size;
        }
        
        // 检测上下边界碰撞
        if (newY <= 0) {
          newSpeedY = -newSpeedY;
          newY = 0;
        } else if (newY >= containerHeight - size) {
          newSpeedY = -newSpeedY;
          newY = containerHeight - size;
        }
        
        // 更新位置和速度
        this.tennisAnimation.x = newX;
        this.tennisAnimation.y = newY;
        this.tennisAnimation.speedX = newSpeedX;
        this.tennisAnimation.speedY = newSpeedY;
        
        // 更新旋转角度（根据移动方向决定旋转方向）
        // 如果速度方向改变，旋转方向也应该相应调整
        const currentRotateSpeed = (Math.abs(newSpeedX) + Math.abs(newSpeedY)) * 2;
        this.tennisAnimation.rotateSpeed = currentRotateSpeed;
        this.tennisAnimation.rotate += currentRotateSpeed;
        
        // 保持角度在 0-360 范围内
        if (this.tennisAnimation.rotate >= 360) {
          this.tennisAnimation.rotate -= 360;
        } else if (this.tennisAnimation.rotate < 0) {
          this.tennisAnimation.rotate += 360;
        }
        
        // 更新视图 - 使用 Math.round 确保是整数
        this.setData({
          tennisX: Math.round(newX),
          tennisY: Math.round(newY),
          tennisRotate: Math.round(this.tennisAnimation.rotate),
        });
        
        // 继续动画 - 使用更短的间隔确保流畅
        this.animationTimer = setTimeout(() => {
          animate();
        }, 16); // 约 60fps
      };
      
      animate();
    },
  },

  attached: function () {
    // 计算 desc 的宽高
    const windowInfo = wx.getWindowInfo();
    const screenWidth = windowInfo.windowWidth || windowInfo.screenWidth;
    const descWidth = screenWidth - 32;
    const aspectRatio = 1.9230769230769231;
    const descHeight = descWidth / aspectRatio;
    
    this.setData({
      descWidth,
      descHeight,
    });
  },
  
  ready: function () {
    // 在 ready 生命周期中启动动画，确保 DOM 已渲染
    this.initTennisAnimation();
  },
  
  detached() {
    // 组件销毁时清除动画
    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
    this.tennisAnimation = null;
  },
});
