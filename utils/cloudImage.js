/**
 * 云存储 fileID → 临时 HTTPS，用于 image 组件展示
 */
function getTempFileURLFromFileID(fileID) {
  if (!fileID) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [{ fileID }],
      maxAge: 60 * 60 * 24 * 7,
      success: (res) => {
        const url = res?.fileList?.[0]?.tempFileURL || '';
        resolve(url);
      },
      fail: reject,
    });
  });
}

/**
 * 将数据库中的图片字段转为可展示的 URL（https、cloud://、包内路径）
 */
async function resolveImageUrlForDisplay(stored) {
  if (stored == null) return '';
  const v = String(stored).trim();
  if (!v) return '';
  if (v.startsWith('http://') || v.startsWith('https://')) return v;
  if (v.startsWith('cloud://')) return getTempFileURLFromFileID(v);
  if (v.startsWith('/')) return v;
  return v;
}

function chooseLocalImageTempPath() {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.tempFilePath) {
          reject(new Error('未选择图片'));
          return;
        }
        resolve(f.tempFilePath);
      },
      fail: reject,
    });
  });
}

/**
 * 相册/拍照选图并上传到云存储，返回 fileID
 * @param {string} cloudPathPrefix 如 admin-media/venue（勿尾斜杠）
 */
async function uploadTempImageToCloud(cloudPathPrefix) {
  const tempFilePath = await chooseLocalImageTempPath();
  const extMatch = tempFilePath.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  const prefix = String(cloudPathPrefix || 'admin-media').replace(/\/$/, '');
  const cloudPath = `${prefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath });
  return res.fileID || '';
}

module.exports = {
  getTempFileURLFromFileID,
  resolveImageUrlForDisplay,
  uploadTempImageToCloud,
};
