const { markProfileSummaryStale } = require('../api/tennisDb');

const STORAGE_USER_PHONE = 'user_phone';
const MEMBER_ASSET_SIGNAL_KIND = 'member_asset';
const SIGNAL_COLLECTION = 'db_booking_realtime_signal';
const REFRESH_DEBOUNCE_MS = 200;

function isTransportError(err) {
  if (!err) return false;
  const code = err.errCode !== undefined ? err.errCode : err.code;
  const msg = String(err.errMsg || err.message || err || '');
  if (code === -402002) return true;
  return /ws connection|login fail|invalid state|init watch fail|realtime listener/i.test(msg);
}

function getLoggedInPhone() {
  try {
    return String(wx.getStorageSync(STORAGE_USER_PHONE) || '').trim();
  } catch (e) {
    return '';
  }
}

function bumpMemberAssetWatchSession(page) {
  if (!page) return;
  page._memberAssetWatchSessionGen = (page._memberAssetWatchSessionGen || 0) + 1;
}

function clearMemberAssetWatchTimers(page) {
  if (!page) return;
  if (page._memberAssetRefreshTimer) {
    clearTimeout(page._memberAssetRefreshTimer);
    page._memberAssetRefreshTimer = null;
  }
  if (page._memberAssetReconnectTimer) {
    clearTimeout(page._memberAssetReconnectTimer);
    page._memberAssetReconnectTimer = null;
  }
  if (page._memberAssetWatchErrorDeferTimer) {
    clearTimeout(page._memberAssetWatchErrorDeferTimer);
    page._memberAssetWatchErrorDeferTimer = null;
  }
}

function stopMemberAssetRealtimeWatch(page) {
  if (!page) return;
  clearMemberAssetWatchTimers(page);
  page._memberAssetWatchKey = '';
  page._memberAssetWatchFailCount = 0;
  const w = page._memberAssetWatcher;
  page._memberAssetWatcher = null;
  if (w && typeof w.close === 'function') {
    try {
      w.close();
    } catch (e) {
      // ignore
    }
  }
}

function scheduleMemberAssetChange(page, onChanged) {
  if (!page || typeof onChanged !== 'function') return;
  if (page._memberAssetRefreshTimer) {
    clearTimeout(page._memberAssetRefreshTimer);
    page._memberAssetRefreshTimer = null;
  }
  page._memberAssetRefreshTimer = setTimeout(() => {
    page._memberAssetRefreshTimer = null;
    markProfileSummaryStale();
    onChanged();
  }, REFRESH_DEBOUNCE_MS);
}

function restartMemberAssetRealtimeWatch(page, onChanged) {
  if (!page) return;
  const phone = getLoggedInPhone();
  if (!/^1\d{10}$/.test(phone) || !wx.cloud || !wx.cloud.database) {
    stopMemberAssetRealtimeWatch(page);
    return;
  }
  if (page._memberAssetWatchKey === phone && page._memberAssetWatcher) {
    return;
  }

  stopMemberAssetRealtimeWatch(page);
  page._memberAssetWatchKey = phone;
  page._memberAssetWatchFailCount = 0;
  page._memberAssetWatchLoggedNoise = false;
  const sessionAtWatch = page._memberAssetWatchSessionGen || 0;
  const db = wx.cloud.database();

  const watcher = db
    .collection(SIGNAL_COLLECTION)
    .where({
      signalKind: MEMBER_ASSET_SIGNAL_KIND,
      phone,
    })
    .watch({
      onChange: () => {
        if (sessionAtWatch !== (page._memberAssetWatchSessionGen || 0)) return;
        page._memberAssetWatchFailCount = 0;
        scheduleMemberAssetChange(page, onChanged);
      },
      onError: (err) => {
        if (sessionAtWatch !== (page._memberAssetWatchSessionGen || 0)) return;
        const transport = isTransportError(err);
        if (transport) {
          if (!page._memberAssetWatchLoggedNoise) {
            page._memberAssetWatchLoggedNoise = true;
            console.warn(
              '[会员资产] 实时监听暂不可用（多为开发者工具/网络导致 WebSocket 未就绪）；真机一般可正常监听。',
              err && err.errMsg ? err.errMsg : err,
            );
          }
        } else {
          console.error('memberAssetRealtime watch error', err);
        }
        page._memberAssetWatchFailCount = (page._memberAssetWatchFailCount || 0) + 1;
        const baseMs = transport ? 5000 : 1500;
        const reconnectMs = Math.min(
          60000,
          Math.round(baseMs * Math.pow(1.35, Math.min(page._memberAssetWatchFailCount - 1, 14))),
        );
        if (page._memberAssetReconnectTimer) {
          clearTimeout(page._memberAssetReconnectTimer);
          page._memberAssetReconnectTimer = null;
        }
        if (page._memberAssetWatchErrorDeferTimer) {
          clearTimeout(page._memberAssetWatchErrorDeferTimer);
        }
        page._memberAssetWatchErrorDeferTimer = setTimeout(() => {
          page._memberAssetWatchErrorDeferTimer = null;
          if (sessionAtWatch !== (page._memberAssetWatchSessionGen || 0)) return;
          if (page._memberAssetWatcher != null && page._memberAssetWatcher !== watcher) {
            return;
          }
          stopMemberAssetRealtimeWatch(page);
          page._memberAssetReconnectTimer = setTimeout(() => {
            page._memberAssetReconnectTimer = null;
            if (sessionAtWatch !== (page._memberAssetWatchSessionGen || 0)) return;
            restartMemberAssetRealtimeWatch(page, onChanged);
          }, reconnectMs);
        }, 0);
      },
    });
  page._memberAssetWatcher = watcher;
}

function invokePageMemberAssetChanged(page) {
  if (typeof page._memberAssetOnChanged === 'function') {
    page._memberAssetOnChanged();
  }
}

function attachPageMemberAssetRealtime(page, onChanged) {
  if (!page || typeof onChanged !== 'function') return;
  page._memberAssetOnChanged = onChanged;
  page._memberAssetWatchFailCount = 0;
  page._memberAssetWatchLoggedNoise = false;
  if (!page._memberAssetWatchInvoker) {
    page._memberAssetWatchInvoker = () => invokePageMemberAssetChanged(page);
  }
  restartMemberAssetRealtimeWatch(page, page._memberAssetWatchInvoker);
}

function detachPageMemberAssetRealtime(page) {
  if (!page) return;
  bumpMemberAssetWatchSession(page);
  clearMemberAssetWatchTimers(page);
  if (page._memberAssetReconnectTimer) {
    clearTimeout(page._memberAssetReconnectTimer);
    page._memberAssetReconnectTimer = null;
  }
  stopMemberAssetRealtimeWatch(page);
  page._memberAssetOnChanged = null;
}

module.exports = {
  bumpMemberAssetWatchSession,
  restartMemberAssetRealtimeWatch,
  stopMemberAssetRealtimeWatch,
  attachPageMemberAssetRealtime,
  detachPageMemberAssetRealtime,
};
