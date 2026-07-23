(function () {
    'use strict';

    const CONSTANTS = {
        LONGE_API_BASE: "https://www.longehuanxinjs.com/ccb_equity_api_new",
        WORKER_API_BASE: "https://longe.xn--fiqz59cpva341l.top",
        CONFIG_KEY: "APP_LOGIN_PAYLOAD",
        STORE_PAYLOADS_KEY: "APP_LOGIN_PAYLOADS",
        CURRENT_STORE_INDEX_KEY: "APP_CURRENT_STORE_INDEX",
        RECENT_GOODS_KEY: "APP_RECENT_GOODS_V1",
        DEFAULT_PAYLOAD: "",
        DINGTALK_WEBHOOK_KEY: "DINGTALK_WEBHOOK",
        DINGTALK_SECRET_KEY: "DINGTALK_SECRET",
        AI_ENABLE_KEY: "AI_PARSE_ENABLE",
        AI_ENDPOINT_KEY: "AI_PARSE_ENDPOINT",
        AI_MODEL_KEY: "AI_PARSE_MODEL",
        AI_KEY_KEY: "AI_PARSE_KEY",
        PRODUCT_POOL_KEY: "PRODUCT_POOL_PATH",
        ORDER_QUEUE_KEY: "ORDER_QUEUE_BY_STORE_V1",
        ORDER_PUSH_SENT_KEY: "ORDER_PUSH_SENT_V1",
        ORDER_POLL_INTERVAL_MS: 5000,
        ORDER_QUEUE_TTL_MS: 24 * 60 * 60 * 1000,
        PUSH_SENT_TTL_MS: 7 * 24 * 60 * 60 * 1000,
        LOG_MAX_ENTRIES: 300,
        VERSION_CLICK_THRESHOLD: 5,
        VERSION_CLICK_TIMEOUT: 1200,
        CACHED_VERSION_KEY: "APP_CACHED_VERSION",
        VERSION_POLL_INTERVAL: 30 * 60 * 1000,
        DRAFTS_KEY: "ORDER_DRAFTS_V1",
        DRAFTS_TTL_MS: 7 * 24 * 60 * 60 * 1000
    };

    const payStates = {
        0: "待付款", 1: "支付中", 2: "已付款",
        3: "支付失败", 4: "支付超时", 5: "已退款", 6: "订单已取消",
        7: "退款中", 8: "已退款", 9: "退款中",
        10: "部分退款-已退款", 11: "部分退款-退款中", 12: "部分退款-全额已退"
    };

    const payStateGroups = {
        g_pending: [0, 1],
        g_paid: [2],
        g_failed: [3, 4, 6],
        g_refunded: [5, 8]
    };

    const recordStates = {
        0: "待补录", 1: "部分补录", 2: "核销失败", 3: "核销成功"
    };

    const ORDER_TERMINAL_STATES = [2, 3, 4, 5, 6, 8, 10, 12];

    const state = {
        loginPayload: CONSTANTS.DEFAULT_PAYLOAD,
        dingTalkWebhook: "",
        dingTalkSecret: "",
        aiEnable: false,
        aiEndpoint: "",
        aiModel: "",
        aiKey: "",
        productPoolPath: "",
        currentToken: "",
        orderToCancel: "",
        orderToRefund: "",
        orderToPush: null,
        currentQrOrderNumber: "",
        regionTree: {},
        orderQueueByStore: { version: 1, updatedAt: 0, stores: {} },
        orderPushSentMap: {},
        pollTimeoutId: null,
        isPolling: false,
        isCheckingOrders: false,
        storePayloads: [],
        currentStoreIndex: 0,
        recentGoodsList: [],
        versionClickCount: 0,
        versionClickTimer: null,
        currentDetailOrder: null,
        remindPollTimer: null,
        isRemindPolling: false,
        draftsData: { version: 1, drafts: {} },
        currentDraftId: null,
        _queuedOrdersCache: null,
        _queuedOrdersCacheDirty: true,
        orderCurrentPage: 1,
        orderHasMore: false,
        orderLoadingMore: false,
        orderSearchResults: [],
        orderSubStates: null
    };

    const els = {};

    function initElements() {
        els.city = document.querySelector('#citySelect');
        els.district = document.querySelector('#districtSelect');
        els.town = document.querySelector('#townSelect');
        els.shopName = document.querySelector('#displayShopName');
        els.statusBadge = document.querySelector('#tokenStatusBadge');
        els.configDialog = document.querySelector('#configDialog');
        els.dingWebhookInput = document.querySelector('#configDingWebhook');
        els.dingSecretInput = document.querySelector('#configDingSecret');
        els.payloadList = document.querySelector('#payloadList');
        els.shopSwitchMenu = document.querySelector('#shopSwitchMenu');
        els.errorDialog = document.querySelector('#errorDialog');
        els.errorContent = document.querySelector('#errorContent');
        els.detailDialog = document.querySelector('#detailDialog');
        els.confirmDialog = document.querySelector('#confirmDialog');
        els.refundDialog = document.querySelector('#refundConfirmDialog');
        els.pushDialog = document.querySelector('#pushConfirmDialog');
        els.pushMobileInput = document.querySelector('#pushMobileInput');
        els.qrDialog = document.querySelector('#qrDialog');
        els.qrImage = document.querySelector('#qrImage');
        els.qrLoading = document.querySelector('#qrLoading');
    }

    function safeParseJSON(raw, fallback) {
        try {
            return JSON.parse(raw);
        } catch (_) {
            return fallback;
        }
    }

    function escapeHtml(text = "") {
        const escapeMap = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };
        return String(text).replace(/[&<>"']/g, (char) => escapeMap[char]);
    }

    function showSnackbar(opts) {
        if (typeof opts === 'string') opts = { message: opts };
        opts.placement = opts.placement || 'bottom-start';
        return mdui.snackbar(opts);
    }

    function getCurrentStoreKey() {
        return `store_${state.currentStoreIndex}`;
    }

    function parseStoreIndexFromKey(storeKey = "") {
        const match = String(storeKey).match(/^store_(\d+)$/);
        return match ? parseInt(match[1], 10) : -1;
    }

    function getStoreDisplayName(store, index) {
        return store.shopName || store.name || `门店${index + 1}`;
    }

    function loadOrderQueue() {
        const raw = localStorage.getItem(CONSTANTS.ORDER_QUEUE_KEY);
        const parsed = raw ? safeParseJSON(raw, null) : null;
        if (parsed && parsed.stores && typeof parsed.stores === "object") {
            state.orderQueueByStore = {
                version: 1,
                updatedAt: parsed.updatedAt || Date.now(),
                stores: parsed.stores
            };
        } else {
            state.orderQueueByStore = { version: 1, updatedAt: Date.now(), stores: {} };
        }
    }

    function saveOrderQueue() {
        state.orderQueueByStore.updatedAt = Date.now();
        localStorage.setItem(CONSTANTS.ORDER_QUEUE_KEY, JSON.stringify(state.orderQueueByStore));
    }

    function loadOrderPushSentMap() {
        const raw = localStorage.getItem(CONSTANTS.ORDER_PUSH_SENT_KEY);
        state.orderPushSentMap = raw ? safeParseJSON(raw, {}) : {};
        if (!state.orderPushSentMap || typeof state.orderPushSentMap !== "object") {
            state.orderPushSentMap = {};
        }
    }

    function saveOrderPushSentMap() {
        localStorage.setItem(CONSTANTS.ORDER_PUSH_SENT_KEY, JSON.stringify(state.orderPushSentMap));
    }

    function cleanupOrderPushSentMap() {
        const now = Date.now();
        Object.keys(state.orderPushSentMap).forEach(key => {
            if (now - (state.orderPushSentMap[key] || 0) > CONSTANTS.PUSH_SENT_TTL_MS) {
                delete state.orderPushSentMap[key];
            }
        });
        saveOrderPushSentMap();
    }

    function cleanupOrderQueue() {
        const now = Date.now();
        const stores = state.orderQueueByStore.stores || {};

        Object.keys(stores).forEach(storeKey => {
            const bucket = stores[storeKey];
            const orders = bucket?.orders || {};

            Object.keys(orders).forEach(orderNumber => {
                const item = orders[orderNumber] || {};
                const lastTouch = item.lastCheckAt || item.createdAt || 0;

                if (!lastTouch || now - lastTouch > CONSTANTS.ORDER_QUEUE_TTL_MS) {
                    delete orders[orderNumber];
                }
            });

            if (Object.keys(orders).length === 0) {
                delete stores[storeKey];
            }
        });

        saveOrderQueue();
        invalidateQueuedOrdersCache();
    }

    function ensureStoreQueueBucket(storeKey) {
        if (!state.orderQueueByStore.stores[storeKey]) {
            state.orderQueueByStore.stores[storeKey] = { orders: {} };
        } else if (!state.orderQueueByStore.stores[storeKey].orders) {
            state.orderQueueByStore.stores[storeKey].orders = {};
        }
        return state.orderQueueByStore.stores[storeKey];
    }

    function enqueueOrder(storeKey, orderNumber, meta = {}) {
        addLog(`订单[${orderNumber}]入队轮询，所属门店[${storeKey}]`, "info");
        const bucket = ensureStoreQueueBucket(storeKey);
        bucket.orders[orderNumber] = {
            lastState: Number(meta.lastState ?? 0),
            buyerMobile: meta.buyerMobile || "",
            createdAt: meta.createdAt || Date.now(),
            lastCheckAt: meta.lastCheckAt || 0
        };
        saveOrderQueue();
        invalidateQueuedOrdersCache();
        updateQueueBadge();
    }

    function dequeueOrder(storeKey, orderNumber) {
        addLog(`订单[${orderNumber}]出队（已达终态或手动移除）`, "info");
        const bucket = state.orderQueueByStore.stores[storeKey];
        if (!bucket?.orders?.[orderNumber]) return;
        delete bucket.orders[orderNumber];
        if (Object.keys(bucket.orders).length === 0) {
            delete state.orderQueueByStore.stores[storeKey];
        }
        saveOrderQueue();
        invalidateQueuedOrdersCache();
        updateQueueBadge();
    }

    function invalidateQueuedOrdersCache() {
        state._queuedOrdersCacheDirty = true;
    }

    function getAllQueuedOrders() {
        if (!state._queuedOrdersCacheDirty && state._queuedOrdersCache) {
            return state._queuedOrdersCache;
        }
        const list = [];
        Object.keys(state.orderQueueByStore.stores || {}).forEach(storeKey => {
            const orders = state.orderQueueByStore.stores[storeKey]?.orders || {};
            Object.keys(orders).forEach(orderNumber => {
                list.push({
                    storeKey,
                    orderNumber,
                    item: orders[orderNumber]
                });
            });
        });
        state._queuedOrdersCache = list;
        state._queuedOrdersCacheDirty = false;
        return list;
    }

    function findOrderInQueue(orderNumber) {
        for (const storeKey in state.orderQueueByStore.stores) {
            const orders = state.orderQueueByStore.stores[storeKey].orders;
            if (orders && orders[orderNumber]) {
                return { storeKey, item: orders[orderNumber] };
            }
        }
        return null;
    }

    function hasQueuedOrders() {
        for (const storeKey in state.orderQueueByStore.stores) {
            const orders = state.orderQueueByStore.stores[storeKey]?.orders;
            if (orders && Object.keys(orders).length > 0) return true;
        }
        return false;
    }

    function generateDraftId() {
        return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }

    function loadDrafts() {
        const raw = localStorage.getItem(CONSTANTS.DRAFTS_KEY);
        const parsed = raw ? safeParseJSON(raw, null) : null;
        if (parsed && parsed.drafts && typeof parsed.drafts === "object") {
            state.draftsData = { version: 1, drafts: parsed.drafts };
        } else {
            state.draftsData = { version: 1, drafts: {} };
        }
    }

    function saveDraftsToStorage() {
        localStorage.setItem(CONSTANTS.DRAFTS_KEY, JSON.stringify(state.draftsData));
    }

    function getCurrentStoreDrafts() {
        const storeKey = getCurrentStoreKey();
        return state.draftsData.drafts[storeKey] || [];
    }

    function setCurrentStoreDrafts(list) {
        state.draftsData.drafts[getCurrentStoreKey()] = list;
    }

    function getDraftById(draftId) {
        for (const storeKey in state.draftsData.drafts) {
            const arr = state.draftsData.drafts[storeKey] || [];
            const found = arr.find(d => d.id === draftId);
            if (found) return found;
        }
        return null;
    }

    function getSelectedCategoryValue() {
        const chips = document.querySelectorAll('#productCategoryChips mdui-chip');
        const selected = Array.from(chips).find(c => c.selected);
        return selected ? selected.value : "";
    }

    function setSelectedCategory(value) {
        const chips = document.querySelectorAll('#productCategoryChips mdui-chip');
        chips.forEach(c => { c.selected = (c.value === value); });
    }

    function getTownNameByCode(townCode) {
        if (!townCode) return "";
        const city = els.city.value;
        const district = els.district.value;
        if (city && district && state.regionTree[city]?.[district]) {
            const t = state.regionTree[city][district].find(x => x.value === townCode);
            if (t) return t.text;
        }
        return "";
    }

    function collectCurrentFormData() {
        return {
            buyerName: document.querySelector('#buyerName').value,
            buyerMobile: document.querySelector('#buyerMobile').value,
            category: getSelectedCategoryValue(),
            city: els.city.value,
            district: els.district.value,
            townCode: els.town.value,
            townName: getTownNameByCode(els.town.value),
            detailAddress: document.querySelector('#detailAddress').value,
            goodsCode: document.querySelector('#goodsCode').value,
            goodsName: document.querySelector('#goodsCode').dataset.goodsName || '',
            filingPrice: document.querySelector('#filingPrice').value,
            shopPrice: document.querySelector('#shopPrice').value,
            actualPrice: document.querySelector('#actualPrice').value,
            subsidyPrice: document.querySelector('#subsidyPrice').value,
            sncode: document.querySelector('#sncode').value,
            autoOrderNum: document.querySelector('#autoOrderNumCheckbox').checked,
            shopOrderNumber: document.querySelector('#shopOrderNumber').value
        };
    }

    function isFormHasContent() {
        const fd = collectCurrentFormData();
        return !!(fd.buyerName || fd.buyerMobile || fd.goodsCode || fd.detailAddress);
    }

    function autoGenerateDraftLabel(fd) {
        const name = fd.buyerName || "";
        const goodsName = fd.goodsName || "";
        const mobile = fd.buyerMobile || "";
        if (name && goodsName) return `${name} - ${goodsName}`;
        if (name) return name;
        if (goodsName && mobile) return goodsName;
        if (goodsName) return goodsName;
        if (mobile) return mobile;
        return "未命名暂存";
    }

    function createDraft(label) {
        const fd = collectCurrentFormData();
        const now = Date.now();
        const draft = {
            id: generateDraftId(),
            label: label || autoGenerateDraftLabel(fd),
            createdAt: now,
            updatedAt: now,
            formData: fd
        };
        const list = getCurrentStoreDrafts();
        list.unshift(draft);
        setCurrentStoreDrafts(list);
        saveDraftsToStorage();
        state.currentDraftId = draft.id;
        addLog(`创建暂存: ${draft.label}`, "info");
        return draft;
    }

    function updateDraft(draftId) {
        const fd = collectCurrentFormData();
        const storeKey = getCurrentStoreKey();
        const list = state.draftsData.drafts[storeKey] || [];
        const draft = list.find(d => d.id === draftId);
        if (!draft) return false;
        const oldAutoLabel = autoGenerateDraftLabel(draft.formData);
        draft.formData = fd;
        draft.updatedAt = Date.now();
        if (draft.label === oldAutoLabel || !draft.label) {
            draft.label = autoGenerateDraftLabel(fd);
        }
        saveDraftsToStorage();
        return true;
    }

    function deleteDraft(draftId) {
        const storeKey = getCurrentStoreKey();
        const list = state.draftsData.drafts[storeKey] || [];
        const idx = list.findIndex(d => d.id === draftId);
        if (idx === -1) return;
        list.splice(idx, 1);
        state.draftsData.drafts[storeKey] = list;
        saveDraftsToStorage();
        if (state.currentDraftId === draftId) {
            state.currentDraftId = null;
        }
        addLog(`删除暂存`, "info");
    }

    function clearCurrentStoreDrafts() {
        state.draftsData.drafts[getCurrentStoreKey()] = [];
        saveDraftsToStorage();
        state.currentDraftId = null;
        addLog("已清空当前门店所有暂存", "info");
    }

    async function loadDraftToForm(draftId) {
        const draft = getDraftById(draftId);
        if (!draft) return false;
        const fd = draft.formData;

        document.querySelector('#buyerMobile').value = fd.buyerMobile || '';
        document.querySelector('#buyerName').value = fd.buyerName || '';
        await new Promise(r => setTimeout(r, 200));

        setSelectedCategory(fd.category);
        await new Promise(r => setTimeout(r, 150));

        if (fd.city && state.regionTree[fd.city]) {
            els.city.value = fd.city;
            await new Promise(r => setTimeout(r, 150));
            populateSelect(els.district, Object.keys(state.regionTree[fd.city]), fd.district);
            await new Promise(r => setTimeout(r, 200));
            const towns = state.regionTree[fd.city]?.[fd.district] || [];
            populateSelect(els.town, towns, fd.townCode);
            await new Promise(r => setTimeout(r, 150));
        }

        document.querySelector('#detailAddress').value = fd.detailAddress || '';
        await new Promise(r => setTimeout(r, 150));

        document.querySelector('#goodsCode').value = fd.goodsCode || '';
        document.querySelector('#goodsCode').dataset.goodsName = fd.goodsName || '';
        if (fd.goodsCode && fd.goodsName) {
            saveRecentGoods(fd.goodsCode, fd.goodsName);
        }
        await new Promise(r => setTimeout(r, 200));

        document.querySelector('#filingPrice').value = fd.filingPrice || '';
        await new Promise(r => setTimeout(r, 100));
        document.querySelector('#shopPrice').value = fd.shopPrice || '';
        await new Promise(r => setTimeout(r, 100));
        document.querySelector('#actualPrice').value = fd.actualPrice || '';
        await new Promise(r => setTimeout(r, 100));
        document.querySelector('#subsidyPrice').value = fd.subsidyPrice || '';
        await new Promise(r => setTimeout(r, 100));

        document.querySelector('#sncode').value = fd.sncode || '';
        await new Promise(r => setTimeout(r, 150));

        document.querySelector('#autoOrderNumCheckbox').checked = fd.autoOrderNum !== false;
        toggleOrderInput();

        state.currentDraftId = draftId;
        renderDraftBar();
        updateDraftBadge();
        addLog(`已加载暂存: ${draft.label}`, "info");
        return true;
    }

    function cleanupExpiredDrafts() {
        const now = Date.now();
        let cleaned = 0;
        for (const storeKey in state.draftsData.drafts) {
            const list = state.draftsData.drafts[storeKey] || [];
            const filtered = list.filter(d => {
                const valid = (now - d.updatedAt) < CONSTANTS.DRAFTS_TTL_MS;
                if (!valid) cleaned++;
                return valid;
            });
            state.draftsData.drafts[storeKey] = filtered;
            if (filtered.length === 0) delete state.draftsData.drafts[storeKey];
        }
        if (cleaned > 0) {
            addLog(`已清理 ${cleaned} 条过期暂存`, "info");
            saveDraftsToStorage();
        }
    }

    function renderDraftBar() {
        const bar = document.getElementById('draftBar');
        if (!bar) return;

        const drafts = getCurrentStoreDrafts();
        const count = drafts.length;

        bar.innerHTML = `
            <div class="draft-bar-left">
                <mdui-icon name="bookmark_border" style="font-size:18px; opacity: ${count > 0 ? '1' : '0.5'};"></mdui-icon>
                <span style="opacity: ${count > 0 ? '1' : '0.6'};">暂存列表${count > 0 ? ` (${count})` : ''}</span>
            </div>
            <div class="draft-bar-actions">
                <mdui-button variant="text" size="small" id="draftSaveNewBtn">暂存</mdui-button>
                <mdui-button variant="text" size="small" id="draftExpandBtn">查看</mdui-button>
            </div>
        `;
        document.getElementById('draftSaveNewBtn')?.addEventListener('click', saveCurrentAsDraft);
        document.getElementById('draftExpandBtn')?.addEventListener('click', openDraftDrawer);
        bar.style.display = 'flex';
    }

    function saveCurrentAsDraft() {
        if (!isFormHasContent()) {
            return showSnackbar({ message: "表单为空，请先填写内容" });
        }
        const draft = createDraft();
        showSnackbar({ message: `已暂存: ${draft.label}` });
        renderDraftBar();
        updateDraftBadge();
    }

    function updateDraftBadge() {
        const badge = document.getElementById('draftBadge');
        if (!badge) return;
        const count = getCurrentStoreDrafts().length;
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    function updateQueueBadge() {
        const badge = document.getElementById('orderQueueBadge');
        if (!badge) return;
        const count = getAllQueuedOrders().length;
        if (count > 0) {
            badge.textContent = count > 9 ? '9+' : count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    function openDraftDrawer() {
        const drawer = document.getElementById('draftDrawer');
        if (drawer) drawer.open = true;
        renderDraftDrawerList();
    }

    function renderDraftDrawerList() {
        const container = document.getElementById('draftListContainer');
        if (!container) return;
        const drafts = getCurrentStoreDrafts();

        if (!drafts.length) {
            container.innerHTML = `
                <div class="draft-empty">
                    <mdui-icon name="bookmark_border" style="font-size:48px; opacity:0.3;"></mdui-icon>
                    <span>暂无暂存订单</span>
                </div>
            `;
            return;
        }

        container.innerHTML = drafts.map(d => {
            const fd = d.formData;
            const timeStr = new Date(d.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const addr = fd.detailAddress || '';
            const priceStr = fd.actualPrice ? `¥${fd.actualPrice}` : '';
            const isActive = d.id === state.currentDraftId;
            const title = fd.goodsName || d.label;

            return `
                <div class="draft-card ${isActive ? 'draft-card-active' : ''}" data-draft-id="${escapeHtml(d.id)}">
                    <div class="draft-card-header">
                        <span class="draft-card-label">${escapeHtml(title)}</span>
                        ${isActive ? '<span class="draft-card-active-badge">当前</span>' : ''}
                    </div>
                    <div class="draft-card-info">
                        ${fd.buyerName ? `<span>${escapeHtml(fd.buyerName)}</span>` : ''}
                        <span>${escapeHtml(fd.buyerMobile || '未填手机号')}</span>
                        ${addr ? `<span>· ${escapeHtml(addr)}</span>` : ''}
                        ${priceStr ? `<span style="color:rgb(var(--mdui-color-primary)); font-weight:600;">${priceStr}</span>` : ''}
                    </div>
                    <div class="draft-card-footer">
                        <span class="draft-card-time">${timeStr}</span>
                        <div class="draft-card-actions">
                            <mdui-button variant="tonal" size="small" class="draft-load-btn" data-draft-id="${escapeHtml(d.id)}">加载</mdui-button>
                            <mdui-button variant="text" size="small" class="draft-del-btn" data-draft-id="${escapeHtml(d.id)}" style="color: rgb(var(--mdui-color-error));">删除</mdui-button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function handleDraftLoad(draftId) {
        const loadBtn = document.querySelector(`.draft-load-btn[data-draft-id="${draftId}"]`);
        if (loadBtn) loadBtn.loading = true;
        await loadDraftToForm(draftId);
        if (loadBtn) loadBtn.loading = false;
        const drawer = document.getElementById('draftDrawer');
        if (drawer) drawer.open = false;
        showSnackbar({ message: "已加载暂存订单" });
    }

    function handleDraftDelete(draftId) {
        deleteDraft(draftId);
        renderDraftDrawerList();
        renderDraftBar();
        updateDraftBadge();
        showSnackbar({ message: "已删除暂存" });
    }

    function makePushSentKey(storeKey, orderNumber, tag = "PAID") {
        return `${storeKey}|${orderNumber}|${tag}`;
    }

    function isOrderPushed(storeKey, orderNumber, tag = "PAID") {
        return !!state.orderPushSentMap[makePushSentKey(storeKey, orderNumber, tag)];
    }

    function markOrderPushed(storeKey, orderNumber, tag = "PAID") {
        state.orderPushSentMap[makePushSentKey(storeKey, orderNumber, tag)] = Date.now();
        saveOrderPushSentMap();
    }

    async function callApiWithToken(token, endpoint, method = 'GET', data = null) {
        const headers = {
            "Content-Type": "application/json",
            token
        };

        let url = `${CONSTANTS.LONGE_API_BASE}${endpoint}`;
        const options = { method, headers };

        if (method === 'GET' && data) {
            url += `?${new URLSearchParams(data).toString()}`;
        } else if (method !== 'GET' && data !== null && data !== undefined) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            const result = await response.json();
            if (result.code !== 0) {
                addLog(`接口响应异常[${endpoint}]: ${result.msg}`, "warn");
            }
            return result;
        } catch (error) {
            addLog(`网络请求失败[${endpoint}]: ${error.message}`, "error");
            return null;
        }
    }

    async function getTokenForStoreKey(storeKey) {
        const storeIndex = parseStoreIndexFromKey(storeKey);
        const store = state.storePayloads[storeIndex];
        if (!store?.payload?.trim()) return "";

        if (storeIndex === state.currentStoreIndex && state.currentToken) {
            return state.currentToken;
        }

        addLog(`正在为[${storeKey}]后台换取Token...`, "info");
        const tokenRes = await requestTokenByPayload(store.payload.trim());
        if (tokenRes?.code === 0 && tokenRes.data) {
            return tokenRes.data;
        }

        return "";
    }

    function stopPolling() {
        if (state.pollTimeoutId) {
            addLog("停止轮询服务", "info");
            clearTimeout(state.pollTimeoutId);
            state.pollTimeoutId = null;
        }
        state.isPolling = false;
    }

    function scheduleNextPolling() {
        if (state.pollTimeoutId) clearTimeout(state.pollTimeoutId);
        state.pollTimeoutId = setTimeout(() => pollOrderStatus("interval"), CONSTANTS.ORDER_POLL_INTERVAL_MS);
        state.isPolling = true;
    }

    async function checkNowAndEnsurePolling(reason = "manual") {
        await pollOrderStatus(reason);
        if (hasQueuedOrders()) {
            scheduleNextPolling();
        } else {
            stopPolling();
        }
    }

    function bindLifecycleRecoveryEvents() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                addLog("浏览器回到前台，恢复检查", "info");
                checkNowAndEnsurePolling("visibilitychange");
            }
        });

        window.addEventListener('pageshow', () => {
            checkNowAndEnsurePolling("pageshow");
        });

        window.addEventListener('focus', () => {
            checkNowAndEnsurePolling("focus");
        });

        window.addEventListener('online', () => {
            addLog("网络已恢复", "info");
            checkNowAndEnsurePolling("online");
        });
    }

    function loadRecentGoods() {
        const raw = localStorage.getItem(CONSTANTS.RECENT_GOODS_KEY);
        state.recentGoodsList = raw ? safeParseJSON(raw, []) : [];
        if (!Array.isArray(state.recentGoodsList)) state.recentGoodsList = [];
        renderRecentGoodsSelect();
    }

    function saveRecentGoods(code, name) {
        state.recentGoodsList = state.recentGoodsList.filter(item => item.code !== code);
        state.recentGoodsList.unshift({ code, name });
        if (state.recentGoodsList.length > 10) {
            state.recentGoodsList = state.recentGoodsList.slice(0, 10);
        }
        localStorage.setItem(CONSTANTS.RECENT_GOODS_KEY, JSON.stringify(state.recentGoodsList));
        renderRecentGoodsSelect(code);
    }

    function renderRecentGoodsSelect(selectedCode = "") {
        const selectEl = document.querySelector('#goodsName');
        selectEl.innerHTML = '';

        const defItem = document.createElement('mdui-menu-item');
        defItem.value = "";
        defItem.innerText = "点此选历史商品↓";
        selectEl.appendChild(defItem);

        state.recentGoodsList.forEach(item => {
            const opt = document.createElement('mdui-menu-item');
            opt.value = item.code;
            opt.innerText = item.name;
            selectEl.appendChild(opt);
        });

        if (selectedCode) {
            setTimeout(() => { selectEl.value = selectedCode; }, 50);
        } else {
            setTimeout(() => { selectEl.value = ""; }, 50);
        }
    }

    let _versionPollTimer = null;

    async function autoUpdateVersion(fromPolling) {
        const baseUrl = `https://api.github.com/repos/lswlc33/new_longehuanxinjs/commits`;

        try {
            const lastOneRes = await fetch(`${baseUrl}?per_page=1`);
            if (!lastOneRes.ok) throw new Error("无法获取最新提交记录");
            const lastOneData = await lastOneRes.json();

            if (!Array.isArray(lastOneData) || lastOneData.length === 0) {
                addLog("未发现提交记录，跳过版本更新", "warn");
                return false;
            }

            const latestFullDate = lastOneData[0].commit.author.date;
            const latestDay = latestFullDate.split('T')[0];

            const since = `${latestDay}T00:00:00Z`;
            const until = `${latestDay}T23:59:59Z`;

            const dayCommitsRes = await fetch(`${baseUrl}?since=${since}&until=${until}&per_page=100`);
            if (!dayCommitsRes.ok) throw new Error("无法统计当日提交数");
            const dayCommitsData = await dayCommitsRes.json();

            const count = dayCommitsData.length;

            const dateParts = latestDay.split('-');
            const yy = dateParts[0].slice(-2);
            const mm = dateParts[1];
            const dd = dateParts[2];
            const versionDate = `${yy}${mm}${dd}`;

            const finalVersion = `V${versionDate}.${count}`;

            const versionEl = document.getElementById('versionTrigger');
            if (versionEl) {
                const oldText = versionEl.innerText;
                const suffixMatch = oldText.match(/[\s\S]*?(V[\d\.]+|版本号：[\d\.]+)(.*)/);
                const suffix = suffixMatch ? suffixMatch[2] : "";

                versionEl.innerText = `版本号：${finalVersion}${suffix}`;
                addLog(`版本号已同步 GitHub: ${finalVersion}`, "info");
            }

            const cachedVersion = localStorage.getItem(CONSTANTS.CACHED_VERSION_KEY) || "";
            const versionChanged = cachedVersion && cachedVersion !== finalVersion;

            if (versionChanged) {
                addLog(`版本变更: ${cachedVersion} -> ${finalVersion}，获取更新日志`, "info");
                if (fromPolling) {
                    showSnackbar({
                        message: `新版本 ${finalVersion} 已发布，请刷新页面`,
                        action: "刷新",
                        onAction: () => location.reload(),
                        closeable: true
                    });
                } else {
                    await fetchAndShowChangelog(latestDay, cachedVersion);
                }
            }
            localStorage.setItem(CONSTANTS.CACHED_VERSION_KEY, finalVersion);

            return versionChanged;

        } catch (error) {
            addLog(`同步版本号失败: ${error.message}`, "warn");
            console.error("Version Sync Error:", error);
            return false;
        }
    }

    async function checkVersionAndPoll() {
        await autoUpdateVersion(true);
        scheduleNextVersionPoll();
    }

    function scheduleNextVersionPoll() {
        clearTimeout(_versionPollTimer);
        _versionPollTimer = setTimeout(checkVersionAndPoll, CONSTANTS.VERSION_POLL_INTERVAL);
    }

    function stopVersionPolling() {
        clearTimeout(_versionPollTimer);
        _versionPollTimer = null;
    }

    async function fetchAndShowChangelog(latestDay, oldVersion) {
        try {
            const baseUrl = `https://api.github.com/repos/lswlc33/new_longehuanxinjs/commits`;
            const res = await fetch(`${baseUrl}?per_page=10`);
            if (!res.ok) return;
            const commits = await res.json();
            if (!Array.isArray(commits) || commits.length === 0) return;

            const grouped = {};
            for (const c of commits) {
                const day = (c.commit.author.date || "").split('T')[0];
                if (!day) continue;
                if (!grouped[day]) grouped[day] = [];
                const msg = (c.commit.message || "").split('\n')[0].trim();
                if (msg) grouped[day].push(msg);
            }

            const days = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).slice(0, 10);
            if (!days.length) return;

            const sections = days.map(day => {
                const msgs = grouped[day];
                const count = msgs.length;
                const dateParts = day.split('-');
                const yy = dateParts[0].slice(-2);
                const mm = dateParts[1];
                const dd = dateParts[2];
                const ver = `V${yy}${mm}${dd}.${count}`;
                const lines = msgs.map(m => `  · ${m}`);
                return `【${ver}】 ${day}\n${lines.join('\n')}`;
            });

            document.getElementById('changelogContent').innerText = sections.join('\n\n');
            document.getElementById('changelogDialog').open = true;
        } catch (e) {
            addLog(`获取更新日志失败: ${e.message}`, "warn");
        }
    }

    async function exportFullConfig() {
        try {
            const configData = {
                stores: state.storePayloads,
                currentIndex: state.currentStoreIndex,
                dingWebhook: localStorage.getItem(CONSTANTS.DINGTALK_WEBHOOK_KEY),
                dingSecret: localStorage.getItem(CONSTANTS.DINGTALK_SECRET_KEY),
                aiEnable: localStorage.getItem(CONSTANTS.AI_ENABLE_KEY),
                aiEndpoint: localStorage.getItem(CONSTANTS.AI_ENDPOINT_KEY),
                aiModel: localStorage.getItem(CONSTANTS.AI_MODEL_KEY),
                aiKey: localStorage.getItem(CONSTANTS.AI_KEY_KEY),
                exportTime: new Date().toLocaleString()
            };

            const configStr = JSON.stringify(configData);
            await navigator.clipboard.writeText(configStr);

            showSnackbar({ message: "配置已复制到剪贴板！" });
            addLog("执行导出配置：数据已写入剪贴板", "info");
        } catch (err) {
            showError("导出失败: " + err);
            addLog("导出配置失败: " + err, "error");
        }
    }

    function importFullConfig() {
        const importDialog = document.getElementById('importConfigDialog');
        const inputField = document.getElementById('importConfigRawInput');

        inputField.value = "";
        importDialog.open = true;
    }

    function confirmImportAction() {
        const inputField = document.getElementById('importConfigRawInput');
        const input = inputField.value.trim();

        if (!input) {
            showSnackbar({ message: "请输入配置内容" });
            return;
        }

        try {
            const data = JSON.parse(input);

            if (data.stores) localStorage.setItem(CONSTANTS.STORE_PAYLOADS_KEY, JSON.stringify(data.stores));
            if (data.currentIndex !== undefined) localStorage.setItem(CONSTANTS.CURRENT_STORE_INDEX_KEY, String(data.currentIndex));
            if (data.dingWebhook !== undefined) localStorage.setItem(CONSTANTS.DINGTALK_WEBHOOK_KEY, data.dingWebhook || "");
            if (data.dingSecret !== undefined) localStorage.setItem(CONSTANTS.DINGTALK_SECRET_KEY, data.dingSecret || "");
            if (data.aiEnable !== undefined) localStorage.setItem(CONSTANTS.AI_ENABLE_KEY, String(data.aiEnable));
            if (data.aiEndpoint !== undefined) localStorage.setItem(CONSTANTS.AI_ENDPOINT_KEY, data.aiEndpoint || "");
            if (data.aiModel !== undefined) localStorage.setItem(CONSTANTS.AI_MODEL_KEY, data.aiModel || "");
            if (data.aiKey !== undefined) localStorage.setItem(CONSTANTS.AI_KEY_KEY, data.aiKey || "");

            addLog("导入配置成功，准备重启应用", "info");

            document.getElementById('importConfigDialog').open = false;

            mdui.alert({
                headline: "导入成功",
                description: "配置已恢复，页面将自动刷新以应用更改。",
                confirmText: "确定",
                onConfirm: () => {
                    window.location.reload();
                }
            });
        } catch (err) {
            addLog("导入配置解析失败: " + err, "error");
            showError("解析失败：无效的 JSON 格式，请确保复制了完整的导出文本。");
        }
    }

    function openLsEditor() {
        document.getElementById('lsEditorDialog').open = true;
        refreshLsEditor();
    }

    function refreshLsEditor() {
        const container = document.getElementById('lsItemList');
        container.innerHTML = '';

        if (localStorage.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#999; padding: 20px;">LocalStorage 为空</div>';
            return;
        }

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);

            const itemDiv = document.createElement('div');
            itemDiv.style.border = '1px solid rgba(0,0,0,0.08)';
            itemDiv.style.padding = '12px';
            itemDiv.style.borderRadius = '12px';
            itemDiv.style.display = 'flex';
            itemDiv.style.flexDirection = 'column';
            itemDiv.style.gap = '8px';
            itemDiv.style.backgroundColor = 'rgb(var(--mdui-color-surface-container-low))';

            const keyLabel = document.createElement('div');
            keyLabel.style.fontWeight = 'bold';
            keyLabel.style.color = 'rgb(var(--mdui-color-primary))';
            keyLabel.style.wordBreak = 'break-all';
            keyLabel.innerText = `Key: ${escapeHtml(key)}`;

            const valueInput = document.createElement('mdui-text-field');
            valueInput.variant = 'outlined';
            valueInput.rows = 2;
            valueInput.value = value;

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'flex-end';
            btnRow.style.gap = '8px';

            const saveBtn = document.createElement('mdui-button');
            saveBtn.variant = 'tonal';
            saveBtn.size = 'small';
            saveBtn.innerText = '保存';
            saveBtn.dataset.key = key;
            saveBtn.dataset.action = 'save';

            const delBtn = document.createElement('mdui-button');
            delBtn.variant = 'text';
            delBtn.size = 'small';
            delBtn.style.color = 'rgb(var(--mdui-color-error))';
            delBtn.innerText = '删除';
            delBtn.dataset.key = key;
            delBtn.dataset.action = 'delete';

            btnRow.appendChild(delBtn);
            btnRow.appendChild(saveBtn);

            itemDiv.appendChild(keyLabel);
            itemDiv.appendChild(valueInput);
            itemDiv.appendChild(btnRow);

            container.appendChild(itemDiv);
        }
    }

    function addNewLsItem() {
        const input = document.getElementById('newLsKey');
        const key = input.value.trim();
        if (!key) {
            showSnackbar({ message: "Key 不能为空" });
            return;
        }
        if (localStorage.getItem(key) !== null) {
            showSnackbar({ message: "该 Key 已存在，请在下方列表中修改" });
            return;
        }
        localStorage.setItem(key, '');
        input.value = '';
        refreshLsEditor();
        addLog(`新增 Storage Key: ${key}`, "info");
    }

    function clearAllLs() {
        mdui.confirm({
            headline: "警告",
            description: "将清空当前域下所有 LocalStorage 数据，包含配置和缓存等，不可恢复！确定吗？",
            confirmText: "确定清空",
            cancelText: "取消",
            onConfirm: () => {
                localStorage.clear();
                refreshLsEditor();
                addLog("已清空所有 LocalStorage 数据", "warn");
                showSnackbar({ message: 'LocalStorage 已清空，建议刷新页面' });
            }
        });
    }

    function handleVersionClick() {
        state.versionClickCount++;
        clearTimeout(state.versionClickTimer);
        if (state.versionClickCount >= CONSTANTS.VERSION_CLICK_THRESHOLD) {
            toggleLogPanel();
            state.versionClickCount = 0;
        }
        state.versionClickTimer = setTimeout(() => { state.versionClickCount = 0; }, CONSTANTS.VERSION_CLICK_TIMEOUT);
    }

    function toggleLogPanel(show) {
        const panel = document.getElementById('debugLogPanel');
        const isCurrentlyOpen = panel.classList.contains('open');
        const shouldOpen = show !== undefined ? show : !isCurrentlyOpen;

        if (shouldOpen) {
            panel.classList.add('open');
            addLog("已开启调试日志面板", "info");
        } else {
            panel.classList.remove('open');
        }
    }

    function addLog(msg, level = 'info') {
        const container = document.getElementById('debugLogContent');
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });

        const logEl = document.createElement('div');
        logEl.className = `log-entry log-level-${level}`;
        logEl.innerHTML = `<span class="log-time">[${escapeHtml(time)}]</span>${escapeHtml(msg)}`;

        container.appendChild(logEl);
        container.scrollTop = container.scrollHeight;

        if (container.children.length > CONSTANTS.LOG_MAX_ENTRIES) {
            container.removeChild(container.firstChild);
        }

        if (level === 'error') console.error(`[${time}] ${msg}`);
        else if (level === 'warn') console.warn(`[${time}] ${msg}`);
        else console.log(`[${time}] ${msg}`);
    }

    function clearDebugLogs() {
        document.getElementById('debugLogContent').innerHTML = '';
        addLog("日志已清空", "info");
    }

    function initializeStorePayloads() {
        const storedList = localStorage.getItem(CONSTANTS.STORE_PAYLOADS_KEY);
        const legacyPayload = localStorage.getItem(CONSTANTS.CONFIG_KEY) || CONSTANTS.DEFAULT_PAYLOAD;
        const savedIndex = parseInt(localStorage.getItem(CONSTANTS.CURRENT_STORE_INDEX_KEY) || "0", 10);

        if (storedList) {
            try {
                const parsed = JSON.parse(storedList);
                if (Array.isArray(parsed) && parsed.length) {
                    state.storePayloads = parsed.map((item, idx) => ({
                        name: item?.name || `门店${idx + 1}`,
                        payload: item?.payload || "",
                        shopName: item?.shopName || "",
                        verified: !!item?.verified
                    }));
                }
            } catch (_) {
                state.storePayloads = [];
            }
        }

        if (!state.storePayloads.length) {
            state.storePayloads = [{
                name: "门店1",
                payload: legacyPayload,
                shopName: "",
                verified: false
            }];
        }

        state.currentStoreIndex = Number.isNaN(savedIndex) ? 0 : Math.min(Math.max(savedIndex, 0), state.storePayloads.length - 1);
        persistStorePayloads();
    }

    function persistStorePayloads() {
        localStorage.setItem(CONSTANTS.STORE_PAYLOADS_KEY, JSON.stringify(state.storePayloads));
        localStorage.setItem(CONSTANTS.CURRENT_STORE_INDEX_KEY, String(state.currentStoreIndex));
        localStorage.setItem(CONSTANTS.CONFIG_KEY, state.storePayloads[state.currentStoreIndex]?.payload || "");
    }

    function renderPayloadInputs() {
        els.payloadList.innerHTML = '';

        state.storePayloads.forEach((store, index) => {
            const item = document.createElement('div');
            item.className = `payload-item ${index === state.currentStoreIndex ? 'active' : ''}`;

            item.innerHTML = `
                <div class="payload-item-header">
                    <mdui-radio
                        name="store-payload-radio"
                        value="${index}"
                        ${index === state.currentStoreIndex ? 'checked' : ''}
                        style="flex: 1; font-size: 14px; font-weight: 600; color: rgb(var(--mdui-color-primary));"
                    >
                        ${`门店 ${index + 1}`}
                    </mdui-radio>
                    <div class="payload-item-actions">
                        <mdui-tooltip content="验证">
                            <mdui-button-icon icon="verified" class="validate-payload-btn" data-index="${index}"></mdui-button-icon>
                        </mdui-tooltip>
                        <mdui-tooltip content="删除">
                            <mdui-button-icon icon="delete" class="remove-payload-btn" data-index="${index}" style="color: rgb(var(--mdui-color-error));" ${state.storePayloads.length <= 1 ? 'disabled' : ''}></mdui-button-icon>
                        </mdui-tooltip>
                    </div>
                </div>
                <mdui-text-field
                    class="payload-input"
                    data-payload-index="${index}"
                    label="Login Payload (Code)"
                    helper="${escapeHtml(`${getStoreDisplayName(store, index)} · ${store.verified ? '已验证' : '未验证'}`)}"
                    variant="outlined"
                    clearable
                ></mdui-text-field>
            `;

            els.payloadList.appendChild(item);
        });

        setTimeout(() => {
            document.querySelectorAll('[data-payload-index]').forEach(input => {
                const idx = Number(input.getAttribute('data-payload-index'));
                input.value = state.storePayloads[idx]?.payload || "";
            });
        }, 0);
    }

    function renderShopSwitchMenu() {
        els.shopSwitchMenu.innerHTML = '';

        state.storePayloads.forEach((store, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `shop-switch-item ${index === state.currentStoreIndex ? 'active' : ''}`;
            item.innerText = getStoreDisplayName(store, index);
            item.dataset.index = index;
            els.shopSwitchMenu.appendChild(item);
        });
    }

    function syncPayloadsFromInputs() {
        const inputs = document.querySelectorAll('[data-payload-index]');
        inputs.forEach(input => {
            const idx = Number(input.getAttribute('data-payload-index'));
            if (state.storePayloads[idx]) {
                state.storePayloads[idx].payload = input.value || "";
            }
        });
    }

    function addPayloadEntry() {
        syncPayloadsFromInputs();
        state.storePayloads.push({
            name: `门店${state.storePayloads.length + 1}`,
            payload: "",
            shopName: "",
            verified: false
        });
        renderPayloadInputs();
    }

    function removePayloadEntry(index) {
        syncPayloadsFromInputs();

        if (state.storePayloads.length <= 1) {
            showSnackbar({ message: "至少需要保留一个门店配置" });
            return;
        }

        state.storePayloads.splice(index, 1);

        if (state.currentStoreIndex > index) {
            state.currentStoreIndex -= 1;
        } else if (state.currentStoreIndex >= state.storePayloads.length) {
            state.currentStoreIndex = state.storePayloads.length - 1;
        }

        state.loginPayload = state.storePayloads[state.currentStoreIndex]?.payload?.trim() || "";
        persistStorePayloads();
        renderPayloadInputs();
        renderShopSwitchMenu();
        updateShopNameDisplay();
    }

    function setCurrentStoreIndex(index, relogin = true) {
        syncPayloadsFromInputs();
        state.currentStoreIndex = index;
        state.loginPayload = state.storePayloads[state.currentStoreIndex]?.payload?.trim() || "";
        persistStorePayloads();
        renderPayloadInputs();
        renderShopSwitchMenu();
        updateShopNameDisplay();

        if (relogin) {
            autoLogin();
        }
    }

    function updateShopNameDisplay() {
        const currentStore = state.storePayloads[state.currentStoreIndex];
        els.shopName.innerText = currentStore ? getStoreDisplayName(currentStore, state.currentStoreIndex) : "未获取门店信息";
    }

    function openShopMenu() {
        renderShopSwitchMenu();
        els.shopSwitchMenu.classList.toggle('open');
    }

    async function switchStore(index) {
        els.shopSwitchMenu.classList.remove('open');
        if (index === state.currentStoreIndex) return;
        state.currentDraftId = null;
        setCurrentStoreIndex(index, true);
        renderDraftBar();
        updateDraftBadge();
        showSnackbar({ message: `正在切换到 ${getStoreDisplayName(state.storePayloads[index], index)}` });
    }

    async function requestTokenByPayload(rawPayload) {
        const payload = rawPayload ? safeParsePayload(rawPayload) : "";
        try {
            const response = await fetch(`${CONSTANTS.LONGE_API_BASE}/miniUser/getToken`, {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            return await response.json();
        } catch (error) {
            addLog("Token请求异常: " + error.message, "error");
            return null;
        }
    }

    async function requestShopInfoByToken(token) {
        try {
            const response = await fetch(`${CONSTANTS.LONGE_API_BASE}/salesuser/getSalesActivity`, {
                method: 'GET',
                headers: {
                    "Content-Type": "application/json",
                    token
                }
            });
            return await response.json();
        } catch (error) {
            addLog("门店信息请求异常: " + error.message, "error");
            return null;
        }
    }

    async function validatePayloadEntry(index) {
        syncPayloadsFromInputs();
        const store = state.storePayloads[index];
        const payloadText = store?.payload?.trim();

        if (!payloadText) {
            return showSnackbar({ message: `门店${index + 1} 的 Payload 不能为空` });
        }

        addLog(`正在验证门店${index + 1} 的Payload...`, "info");
        showSnackbar({ message: `正在验证 ${store.name || `门店${index + 1}`}` });
        const tokenRes = await requestTokenByPayload(payloadText);

        if (!(tokenRes?.code === 0 && tokenRes.data)) {
            addLog(`验证失败: Token获取失败`, "error");
            return showError(`验证失败：${tokenRes?.msg || 'Token获取失败'}`);
        }

        const shopRes = await requestShopInfoByToken(tokenRes.data);
        if (shopRes?.code === 0) {
            const shopName = shopRes.data?.shopInfo?.shopName || store.name || `门店${index + 1}`;
            addLog(`验证成功: ${shopName}`, "info");
            store.shopName = shopName;
            store.name = shopName;
            store.verified = true;
            persistStorePayloads();
            renderPayloadInputs();
            renderShopSwitchMenu();
            updateShopNameDisplay();
            showSnackbar({ message: `验证成功：${shopName}` });
        } else {
            addLog(`验证失败: ${shopRes?.msg || '无法解析门店信息'}`, "error");
            showError(`验证失败：${shopRes?.msg || '门店信息获取失败'}`);
        }
    }

    async function callApi(endpoint, method = 'GET', data = null) {
        const headers = { "Content-Type": "application/json" };
        if (state.currentToken) headers["token"] = state.currentToken;

        let url = `${CONSTANTS.LONGE_API_BASE}${endpoint}`;
        const options = { method, headers };

        if (method === 'GET' && data) {
            url += `?${new URLSearchParams(data).toString()}`;
        } else if (method !== 'GET' && data !== null && data !== undefined) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(url, options);
            const res = await response.json();
            if (res.code !== 0) {
                addLog(`API [${endpoint}] 返回业务错误: ${res.msg}`, "warn");
            }
            return res;
        } catch (error) {
            addLog(`API [${endpoint}] 请求崩溃: ${error.message}`, "error");
            showError("网络请求失败或跨域被拦截");
            return null;
        }
    }

    function showError(msg) {
        els.errorContent.innerText = msg || "未知错误";
        els.errorDialog.open = true;
    }

    function safeParsePayload(raw) {
        try {
            return JSON.parse(raw);
        } catch (_) {
            return raw;
        }
    }

    async function sendDingTalkMessage(content, overrideWebhook, overrideSecret) {
        const accessToken = overrideWebhook !== undefined ? overrideWebhook : state.dingTalkWebhook;
        const secret = overrideSecret !== undefined ? overrideSecret : state.dingTalkSecret;
        const DINGTALK_API_BASE = `${CONSTANTS.WORKER_API_BASE}/api/dingtalk/send`;

        if (!accessToken) {
            addLog("未配置钉钉Webhook，忽略推送请求", "warn");
            return;
        }

        addLog("发起钉钉消息推送...", "info");
        try {
            const response = await fetch(DINGTALK_API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken,
                    secret,
                    content
                })
            });

            const resData = await response.json();
            if (resData.errcode === 0 || resData.code === 0) {
                addLog("钉钉推送成功响应", "info");
            } else {
                addLog(`钉钉推送返回错误: ${resData.errmsg || resData.msg}`, "error");
                showSnackbar({ message: "钉钉推送失败: " + (resData.errmsg || resData.msg || "未知错误") });
            }
        } catch (error) {
            addLog("钉钉推送网络异常: " + error.message, "error");
            showSnackbar({ message: "钉钉推送异常，请检查后端服务" });
        }
    }

    async function testDingTalk() {
        const webhookUrl = els.dingWebhookInput.value.trim();
        const secretVal = els.dingSecretInput.value.trim();
        if (!webhookUrl) {
            return showSnackbar({ message: "请先填写钉钉 Webhook 地址！" });
        }
        const testMsg = "测试消息：您已成功配置钉钉推送！\n\n张三 13800138000\n江苏省-常州市-武进区-南夏墅街道 城市大厦A座\n12345678\n测试商品\n0.01";
        await sendDingTalkMessage(testMsg, webhookUrl, secretVal);
        showSnackbar({ message: "测试推送请求已发送" });
    }

    const isAndroid = /Android/i.test(navigator.userAgent);

    function showNotification(title, body) {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") {
            const options = { body, icon: 'https://unpkg.com/mdui@2/icons/store.svg' };
            if (isAndroid && navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(reg => reg.showNotification(title, options)).catch(() => {
                    showSnackbar({ message: `${title}\n${body}` });
                });
            } else if (isAndroid) {
                showSnackbar({ message: `${title}\n${body}` });
            } else {
                new Notification(title, options);
            }
        }
    }

    function formatPriceText(value) {
        const num = Number(value || 0);
        return `¥${num.toFixed(2)}`;
    }

    function buildDingTalkOrderMessage(order, fallbackMobile = "") {
        const product = order?.goodsOrderList?.[0] || {};
        const buyerName = order?.buyerName || "";
        const mobile = fallbackMobile || order?.buyerMobile || "";
        const address = order?.address || "";
        const goodsText = product.goodsModel || product.goodsName || order?.goodsName || "";
        const actualPrice = formatPriceText(order?.shopActualPayPrice);

        return [
            "订单支付成功！",
            "",
            "建行单号：",
            order?.ccbPayOrderNumber || "",
            `门店单号：${order?.shopOrderNumber || ""}`,
            "用户信息：",
            `${buyerName} ${mobile}`.trim(),
            address,
            `商品：${goodsText}`,
            `实付：${actualPrice}`
        ].join("\n");
    }

    function buildDingTalkRefundMessage(data) {
        const payOrder = data.payOrder;
        const refundOrderVo = data.refundOrderVos?.[0];
        const refundOrder = refundOrderVo?.buyerRefundOrder;
        const refundGoods = refundOrderVo?.refundGoodsOrderList?.[0];

        const buyerName = refundOrder?.buyerName || payOrder?.buyerName || "";
        const buyerMobile = refundOrder?.buyerMobile || payOrder?.buyerMobile || "";
        const address = payOrder?.address || "";
        const goodsText = refundGoods?.goodsName || payOrder?.goodsOrderList?.[0]?.goodsName || "";
        const refundAmount = formatPriceText(refundOrder?.refundAmount || payOrder?.shopActualPayPrice || 0);
        const payTime = payOrder?.payTime || "";
        const refundTime = refundOrder?.updateTime || "";

        return [
            "订单发生了退款操作！",
            "",
            "建行单号：",
            payOrder?.ccbPayOrderNumber || "",
            `门店单号：${payOrder?.shopOrderNumber || ""}`,
            `支付时间，退款时间：${payTime} ${refundTime}`,
            "用户信息：",
            `${buyerName} ${buyerMobile}`.trim(),
            address,
            `商品：${goodsText}`,
            `金额：${refundAmount}`
        ].join("\n");
    }

    async function pollOrderStatus(triggerReason = "interval") {
        if (state.isCheckingOrders) return;
        if (!hasQueuedOrders()) {
            stopPolling();
            return;
        }

        state.isCheckingOrders = true;
        addLog(`启动轮询[原因:${triggerReason}]，当前队列订单数: ${getAllQueuedOrders().length}`, "info");

        try {
            const tokenCache = {};
            const queuedOrders = getAllQueuedOrders();

            for (const entry of queuedOrders) {
                await processQueuedOrder(entry, tokenCache);
            }
        } catch (e) {
            addLog(`轮询核心逻辑异常: ${e.message}`, "error");
        } finally {
            state.isCheckingOrders = false;
        }

        if (hasQueuedOrders()) {
            scheduleNextPolling();
        } else {
            stopPolling();
        }
    }

    async function processQueuedOrder(entry, tokenCache) {
        const { storeKey, orderNumber } = entry;
        const latestItem = state.orderQueueByStore.stores?.[storeKey]?.orders?.[orderNumber];
        if (!latestItem) return;

        if (!tokenCache[storeKey]) {
            tokenCache[storeKey] = await getTokenForStoreKey(storeKey);
        }

        const token = tokenCache[storeKey];
        if (!token) {
            addLog(`无法获取门店[${storeKey}]的Token，跳过单号[${orderNumber}]`, "warn");
            return;
        }

        const res = await callApiWithToken(token, '/salesuser/getSalesOrderDetail', 'GET', { orderNumber });
        if (!(res?.code === 0 && res.data?.payOrder)) return;

        const order = res.data.payOrder;
        const newState = Number(order.payState);
        const oldState = Number(latestItem.lastState ?? 0);

        latestItem.lastState = newState;
        latestItem.lastCheckAt = Date.now();
        saveOrderQueue();

        if (newState !== oldState) {
            await handleOrderStateChange(storeKey, orderNumber, order, newState, oldState, latestItem);
        }
    }

    async function handleOrderStateChange(storeKey, orderNumber, order, newState, oldState, latestItem) {
        addLog(`订单[${orderNumber}]状态变更: ${payStates[oldState] || '未知'} -> ${payStates[newState] || '未知'}`, "info");

        if (newState === 2) {
            showNotification("订单支付成功", `订单号尾号: ${orderNumber.slice(-4)}\n状态: 已付款`);
        }

        if (ORDER_TERMINAL_STATES.includes(newState)) {
            if (newState === 2 && !isOrderPushed(storeKey, orderNumber, "PAID")) {
                if (els.qrDialog.open && state.currentQrOrderNumber === orderNumber) {
                    els.qrDialog.open = false;
                    showSnackbar({ message: "付款成功！" });
                }

                addLog(`订单[${orderNumber}]支付完成，准备发起推送`, "info");
                const msg = buildDingTalkOrderMessage(order, latestItem.buyerMobile || "");
                await sendDingTalkMessage(msg);
                markOrderPushed(storeKey, orderNumber, "PAID");
            }

            dequeueOrder(storeKey, orderNumber);

            if (document.getElementById('orderDrawer').open) {
                fetchOrders();
            }
        }
    }

    function startPolling() {
        if (!hasQueuedOrders()) return;
        if (!state.isPolling) {
            scheduleNextPolling();
        }
    }

    async function autoLogin() {
        const currentStore = state.storePayloads[state.currentStoreIndex];
        state.loginPayload = currentStore?.payload?.trim() || "";

        if (!state.loginPayload) {
            addLog("自动登录取消: 未配置Payload", "warn");
            updateStatus(false, "未配置Payload");
            updateShopNameDisplay();
            return;
        }

        addLog("开始尝试自动登录...", "info");
        updateStatus(false, "正在连接...");
        updateShopNameDisplay();

        const payload = state.loginPayload ? safeParsePayload(state.loginPayload) : "";
        const res = await callApi('/miniUser/getToken', 'POST', payload);

        if (res?.code === 0 && res.data) {
            addLog("Token 获取成功", "info");
            state.currentToken = res.data;
            await checkTokenStatus();
            fetchRegionData();
        } else {
            addLog(`Token 获取失败: ${res?.msg}`, "error");
            updateStatus(false, "Token获取失败");
            showError(`登录失败: ${res?.msg || '请检查配置'}`);
        }
    }

    async function checkTokenStatus() {
        const res = await callApi('/salesuser/getSalesActivity', 'GET');
        if (res?.code === 0) {
            addLog("Token 状态校验通过", "info");
            updateStatus(true);
            const shopName = res.data?.shopInfo?.shopName || "";
            if (shopName) {
                els.shopName.innerText = shopName;
                if (state.storePayloads[state.currentStoreIndex]) {
                    state.storePayloads[state.currentStoreIndex].shopName = shopName;
                    state.storePayloads[state.currentStoreIndex].name = shopName;
                    state.storePayloads[state.currentStoreIndex].verified = true;
                    persistStorePayloads();
                    renderShopSwitchMenu();
                }
            }
        } else {
            addLog(`Token 校验失败: ${res?.msg}`, "error");
            updateStatus(false, "Token无效");
        }
    }

    function updateStatus(active, text = "") {
        if (active) {
            els.statusBadge.innerText = "已连接";
            els.statusBadge.classList.add('active');
        } else {
            els.statusBadge.innerText = text || "未连接";
            els.statusBadge.classList.remove('active');
        }
        updateShopNameDisplay();
    }

    function openConfigDialog() {
        renderPayloadInputs();
        els.dingWebhookInput.value = state.dingTalkWebhook;
        els.dingSecretInput.value = state.dingTalkSecret;

        document.getElementById('configAiEnable').checked = state.aiEnable;
        document.getElementById('configAiEndpoint').value = state.aiEndpoint;
        document.getElementById('configAiModel').value = state.aiModel;
        document.getElementById('configAiKey').value = state.aiKey;
        document.getElementById('configProductPool').value = state.productPoolPath;

        els.configDialog.open = true;
    }

    function closeConfigDialog() {
        els.configDialog.open = false;
    }

    function saveConfig() {
        syncPayloadsFromInputs();

        const validPayloads = state.storePayloads.filter(item => item.payload && item.payload.trim());
        if (!validPayloads.length) {
            return showSnackbar({ message: "请至少填写一个 Payload" });
        }

        state.storePayloads = state.storePayloads.map((item, idx) => ({
            ...item,
            name: item.shopName || item.name || `门店${idx + 1}`
        }));

        if (state.currentStoreIndex >= state.storePayloads.length) {
            state.currentStoreIndex = 0;
        }

        state.loginPayload = state.storePayloads[state.currentStoreIndex]?.payload?.trim() || "";
        state.dingTalkWebhook = els.dingWebhookInput.value.trim();
        state.dingTalkSecret = els.dingSecretInput.value.trim();

        state.aiEnable = document.getElementById('configAiEnable').checked;
        state.aiEndpoint = document.getElementById('configAiEndpoint').value.trim();
        state.aiModel = document.getElementById('configAiModel').value.trim();
        state.aiKey = document.getElementById('configAiKey').value.trim();
        state.productPoolPath = document.getElementById('configProductPool').value.trim();

        addLog("用户保存配置并尝试重连", "info");
        persistStorePayloads();
        localStorage.setItem(CONSTANTS.DINGTALK_WEBHOOK_KEY, state.dingTalkWebhook);
        localStorage.setItem(CONSTANTS.DINGTALK_SECRET_KEY, state.dingTalkSecret);

        localStorage.setItem(CONSTANTS.AI_ENABLE_KEY, state.aiEnable);
        localStorage.setItem(CONSTANTS.AI_ENDPOINT_KEY, state.aiEndpoint);
        localStorage.setItem(CONSTANTS.AI_MODEL_KEY, state.aiModel);
        localStorage.setItem(CONSTANTS.AI_KEY_KEY, state.aiKey);
        localStorage.setItem(CONSTANTS.PRODUCT_POOL_KEY, state.productPoolPath);

        ProductSearch.resetCache();

        renderPayloadInputs();
        renderShopSwitchMenu();
        closeConfigDialog();
        showSnackbar({ message: "配置已保存，正在重连..." });
        autoLogin();
    }

    function populateSelect(selectElement, options, selectedValue = "") {
        selectElement.innerHTML = '';
        const defItem = document.createElement('mdui-menu-item');
        defItem.value = "";
        defItem.innerText = "请选择";
        selectElement.appendChild(defItem);

        options.forEach(opt => {
            const item = document.createElement('mdui-menu-item');
            if (typeof opt === 'string') {
                item.value = opt;
                item.innerText = opt;
            } else {
                item.value = opt.value;
                item.innerText = opt.text;
            }
            selectElement.appendChild(item);
        });

        if (selectedValue) {
            setTimeout(() => {
                selectElement.value = selectedValue;
                setTimeout(() => {
                    if (selectElement.value !== selectedValue) selectElement.value = selectedValue;
                }, 150);
            }, 50);
        } else {
            selectElement.value = "";
        }
    }

    async function fetchRegionData() {
        if (!state.currentToken) return;
        const res = await callApi('/salesuser/getTownList', 'GET');
        if (res?.code === 0 && res.data) {
            parseRegionData(res.data);
            populateSelect(els.city, Object.keys(state.regionTree));
        }
    }

    function parseRegionData(dataArray) {
        state.regionTree = {};
        try {
            dataArray.forEach(cityObj => {
                Object.keys(cityObj).forEach(cityCode => {
                    if (!cityCode.trim()) return;
                    const districtsArr = cityObj[cityCode];
                    if (!Array.isArray(districtsArr)) return;

                    districtsArr.forEach(distObj => {
                        Object.keys(distObj).forEach(distCode => {
                            if (!distCode.trim()) return;
                            const towns = distObj[distCode];
                            if (towns?.length > 0) {
                                const { cityName, districtName } = towns[0];
                                if (!cityName?.trim() || !districtName?.trim()) return;

                                if (!state.regionTree[cityName]) state.regionTree[cityName] = {};
                                if (!state.regionTree[cityName][districtName]) state.regionTree[cityName][districtName] = [];

                                const validTowns = towns
                                    .filter(t => t.townName?.trim() && t.townCode?.trim())
                                    .map(t => ({ text: t.townName, value: t.townCode }));

                                if (validTowns.length) state.regionTree[cityName][districtName] = validTowns;
                            }
                        });
                    });
                });
            });
        } catch (e) {
            console.error("地址解析错误", e);
        }
    }

    function getDefaultTradeMonth() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

    function initTradeMonthSelect() {
        const sel = document.getElementById('orderTradeMonth');
        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
        const labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
        sel.innerHTML = months.map((m, i) =>
            `<option value="${m}"${i + 1 === currentMonth ? ' selected' : ''}>${labels[i]}</option>`
        ).join('');
    }

    function toggleOrderInput() {
        const cb = document.querySelector('#autoOrderNumCheckbox');
        const input = document.querySelector('#shopOrderNumber');
        input.disabled = cb.checked;
        input.value = cb.checked ? "提交时自动生成" : "";
    }

    function openOrderDrawer() {
        initTradeMonthSelect();
        document.getElementById('orderDrawer').open = true;
        fetchOrders();
    }

    async function fetchOrders(page = 1) {
        page = Number(page) || 1;
        const container = document.getElementById('orderListContainer');
        if (!state.currentToken) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">请先获取 Token</div>';
            return;
        }

        const isFirstPage = page === 1;

        if (isFirstPage) {
            addLog("刷新订单列表...", "info");
            container.innerHTML = '<div style="padding: 50px; text-align: center;"><mdui-circular-progress></mdui-circular-progress></div>';
            state.orderSearchResults = [];
            state.orderCurrentPage = 1;
            state.orderHasMore = false;
            state.orderSubStates = null;
        } else {
            state.orderLoadingMore = true;
        }

        const monthVal = document.getElementById('orderTradeMonth').value;
        const tradeMonth = `${new Date().getFullYear()}-${monthVal}`;
        const payStateVal = document.getElementById('orderPayStateFilter').value;
        const recordStateVal = document.getElementById('orderRecordStateFilter').value;
        const searchVal = document.getElementById('orderSearchMobile').value.trim();

        if (isFirstPage) {
            state.orderLastSearchVal = searchVal;
        }

        const baseParams = { tradeMonth, inputStr: searchVal };
        if (recordStateVal !== '') baseParams.recordState = recordStateVal;

        const groupStates = payStateGroups[payStateVal];
        const isGrouped = !!groupStates;

        if (isGrouped) {
            if (isFirstPage || !state.orderSubStates) {
                state.orderSubStates = groupStates.map(s => ({ state: s, page: 1, hasMore: true, fetched: 0, total: null }));
            }

            const subStates = state.orderSubStates.filter(ss => ss.hasMore);
            if (!subStates.length && !isFirstPage) {
                state.orderHasMore = false;
                state.orderLoadingMore = false;
                setupOrderSentinel(false);
                return;
            }

            const results = [];
            for (let i = 0; i < subStates.length; i++) {
                if (i > 0) await new Promise(r => setTimeout(r, 100));
                const ss = subStates[i];
                const params = { ...baseParams, payState: String(ss.state), pageNumber: String(ss.page) };
                const res = await callApi('/salesuser/getShopOrderList', 'GET', params);
                if (res?.code === 0 && Array.isArray(res.data)) {
                    if (res.count != null) ss.total = Number(res.count);
                    ss.fetched += res.data.length;
                    ss.hasMore = ss.total != null ? ss.fetched < ss.total : res.data.length > 0;
                    results.push(res.data);
                } else {
                    ss.hasMore = false;
                    results.push([]);
                }
            }
            const newOrders = results.flat();

            if (!isFirstPage) {
                state.orderSearchResults = [...state.orderSearchResults, ...newOrders];
                subStates.forEach(ss => { ss.page++; });
            } else {
                state.orderSearchResults = newOrders;
                subStates.forEach(ss => { ss.page = 2; });
            }

            state.orderHasMore = subStates.some(ss => ss.hasMore);
            state.orderCurrentPage = page;

            addLog(`获取到订单共 ${state.orderSearchResults.length} 条`, "info");
            if (!state.orderSearchResults.length) {
                container.innerHTML = '<div style="padding: 32px; text-align: center; color: #999;">未找到相关订单</div>';
                state.orderHasMore = false;
                if (!isFirstPage) state.orderLoadingMore = false;
                return;
            }

            renderOrderList(container, state.orderSearchResults, state.orderHasMore);
        } else {
            const params = { ...baseParams, pageNumber: String(page) };
            if (payStateVal !== '') params.payState = payStateVal;

            const res = await callApi('/salesuser/getShopOrderList', 'GET', params);

            if (res?.code === 0 && Array.isArray(res.data)) {
                let orders = res.data;

                if (!isFirstPage) {
                    state.orderSearchResults = [...state.orderSearchResults, ...orders];
                } else {
                    state.orderSearchResults = orders;
                }

                const totalCount = res.count;
                state.orderHasMore = totalCount != null
                    ? state.orderSearchResults.length < Number(totalCount)
                    : orders.length > 0;
                state.orderCurrentPage = page;

                addLog(`获取到订单共 ${state.orderSearchResults.length} 条`, "info");
                if (!state.orderSearchResults.length) {
                    container.innerHTML = '<div style="padding: 32px; text-align: center; color: #999;">未找到相关订单</div>';
                    state.orderHasMore = false;
                    if (!isFirstPage) state.orderLoadingMore = false;
                    return;
                }

                renderOrderList(container, state.orderSearchResults, state.orderHasMore);
            } else {
                if (isFirstPage) {
                    addLog(`加载订单失败: ${res?.msg}`, "error");
                    container.innerHTML = `<div style="text-align: center; color: red;">加载失败: ${escapeHtml(res?.msg || '未知错误')}</div>`;
                }
                state.orderHasMore = false;
            }
        }

        if (!isFirstPage) {
            state.orderLoadingMore = false;
        }
    }

    function renderOrderList(container, orders, hasMore = false) {
        container.innerHTML = orders.map(order => {
            const statusText = payStates[order.payState] || "未知";
            const price = Number(order.shopActualPayPrice || 0).toFixed(2);

            let footerContent = '';
            if (order.payState === 0 || order.payState === 1) {
                footerContent = `
                    <mdui-button icon="qr_code_2" variant="tonal" class="open-qr-btn" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}">
                        去支付
                    </mdui-button>
                    <span class="price-value">¥${escapeHtml(price)}</span>
                `;
            } else {
                footerContent = `
                    <span class="price-label">实付金额</span>
                    <span class="price-value">¥${escapeHtml(price)}</span>
                `;
            }

            return `
            <div class="order-card" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}">
                <div class="card-header">
                    <div>
                        <div class="buyer-name">${escapeHtml(order.shopOrderNumber)}</div>
                        <div class="buyer-mobile">${escapeHtml(order.buyerMobile || '')}</div>
                    </div>
                    <div style="display:flex; align-items: center; gap:4px;">
                        <div class="status-badge status-${order.payState}">${escapeHtml(statusText)}</div>
                        <mdui-button-icon icon="info" variant="standard" class="view-order-detail-btn" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}"></mdui-button-icon>
                    </div>
                </div>
                <div class="info-grid">
                    <span class="label">建行单号:</span><span class="value">${escapeHtml(order.ccbPayOrderNumber || '无')}</span>
                    <span class="label">创建时间:</span><span class="value">${escapeHtml(order.createTime)}</span>
                </div>
                <div class="card-footer">
                    ${footerContent}
                </div>
            </div>`;
        }).join('');

        setupOrderSentinel(hasMore);
    }

    let _orderSentinelObs = null;

    function setupOrderSentinel(hasMore) {
        if (_orderSentinelObs) {
            _orderSentinelObs.disconnect();
            _orderSentinelObs = null;
        }
        const oldSentinel = document.getElementById('orderScrollSentinel');
        if (oldSentinel) oldSentinel.remove();

        const container = document.getElementById('orderListContainer');
        if (!hasMore) {
            if (state.orderSearchResults.length > 0) {
                const endEl = document.createElement('div');
                endEl.id = 'orderScrollSentinel';
                endEl.className = 'order-scroll-sentinel';
                endEl.style.opacity = '0.5';
                endEl.innerHTML = '<span>— 到底了 —</span>';
                container.appendChild(endEl);
            }
            return;
        }

        const sentinel = document.createElement('div');
        sentinel.id = 'orderScrollSentinel';
        sentinel.className = 'order-scroll-sentinel';
        sentinel.innerHTML = '<mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>加载更多...</span>';
        container.appendChild(sentinel);
    }

    function handleOrderListScroll() {
        const container = document.getElementById('orderListContainer');
        if (!container || state.orderLoadingMore || state.orderHasMore === false) return;

        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (scrollBottom < 200) {
            fetchOrders(state.orderCurrentPage + 1);
        }
    }

    let _huanxinRunning = false;

    async function huanxinList() {
        if (_huanxinRunning) return;
        if (!state.orderSearchResults.length) return showSnackbar({ message: "请先加载订单列表" });

        _huanxinRunning = true;
        const refreshBtn = document.getElementById('refreshOrdersBtn');
        const huanxinBtn = document.getElementById('huanxinOrdersBtn');
        refreshBtn.disabled = true;
        huanxinBtn.disabled = true;
        huanxinBtn.textContent = '焕新中...';

        const container = document.getElementById('orderListContainer');
        const cards = container.querySelectorAll('.order-card');

        for (let i = 0; i < state.orderSearchResults.length; i++) {
            const order = state.orderSearchResults[i];
            const card = cards[i];
            if (!card) continue;

            const h = card.offsetHeight;
            card.style.minHeight = h + 'px';
            card.innerHTML = `<div class="huanxin-loading"><mdui-circular-progress style="width:16px;height:16px;"></mdui-circular-progress><span>加载详情...</span></div>`;

            await new Promise(r => setTimeout(r, 200));

            const res = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber: order.ccbPayOrderNumber });

            if (res?.code === 0 && res.data?.payOrder) {
                const detail = res.data.payOrder;
                const product = detail.goodsOrderList?.[0] || {};
                card.innerHTML = renderHuanxinCard(detail, product);
                card.classList.add('order-card-huanxin', 'order-card-flip');
                card.style.animationDelay = '0s';
            } else {
                card.classList.add('order-card-huanxin', 'order-card-flip');
            }

            requestAnimationFrame(() => { card.style.minHeight = ''; });
        }

        _huanxinRunning = false;
        refreshBtn.disabled = false;
        huanxinBtn.disabled = false;
        huanxinBtn.textContent = '焕新';
    }

    function renderHuanxinCard(order, product) {
        const price = Number(order.shopActualPayPrice || 0).toFixed(2);
        const statusText = payStates[order.payState] || '未知';
        const shortAddr = (() => {
            const addr = order.address || '';
            const parts = addr.split('-');
            return parts.length > 2 ? parts.slice(2).join('-').trim() || addr : addr;
        })();
        const goodsModel = product.goodsModel || product.goodsName || '';
        const recordText = order.recordState != null ? (recordStates[order.recordState] || order.recordState) : '';

        return `
            <div class="huanxin-top">
                <div>
                    <span style="font-weight:700;font-size:14px;">${escapeHtml(order.buyerName || '-')}</span>
                    <span style="font-size:12px;color:rgb(var(--mdui-color-outline));margin-left:6px;">${escapeHtml(order.buyerMobile || '')}</span>
                </div>
                <span class="status-badge status-${order.payState}">${escapeHtml(statusText)}</span>
            </div>
            <div class="huanxin-row huanxin-full">
                <span class="huanxin-label">地址</span>
                <span class="huanxin-value">${escapeHtml(shortAddr || '-')}</span>
            </div>
            <div class="huanxin-row huanxin-full">
                <span class="huanxin-label">型号</span>
                <span class="huanxin-value">${escapeHtml(goodsModel || '-')}</span>
            </div>
            ${recordText ? `<div class="huanxin-row"><span class="huanxin-label">核验</span><span class="huanxin-value">${escapeHtml(recordText)}</span></div>` : ''}
            <div class="huanxin-bottom">
                <span style="font-size:11px;color:rgb(var(--mdui-color-outline));">${escapeHtml(order.shopOrderNumber || '')}</span>
                <span style="font-size:16px;font-weight:700;color:rgb(var(--mdui-color-primary));">¥${escapeHtml(price)}</span>
            </div>
        `;
    }

    async function viewOrderDetail(orderNumber) {
        if (!orderNumber) return showSnackbar({ message: "无效订单号" });

        const dialog = els.detailDialog;
        const detailPushBtn = document.getElementById('detailPushBtn');
        state.orderToPush = null;
        detailPushBtn.style.display = 'none';

        dialog.open = true;
        dialog.querySelectorAll('[slot="action"]').forEach(el => el.remove());

        const loading = document.getElementById('detailLoading');
        const content = document.getElementById('detailContent');

        loading.style.display = 'block';
        content.style.display = 'none';

        addActionButton(dialog, "关闭", () => dialog.open = false);

        const res = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber });
        loading.style.display = 'none';

        if (res?.code === 0 && res.data?.payOrder) {
            renderOrderDetail(dialog, res.data.payOrder, detailPushBtn, res.data.refundOrderVos);
        } else {
            content.style.display = 'block';
            content.innerHTML = `<div style="text-align:center; color:red;">获取失败: ${escapeHtml(res?.msg)}</div>`;
        }
    }

    function addActionButton(dialog, text, fn, color = "") {
        const btn = document.createElement('mdui-button');
        btn.slot = "action";
        btn.variant = color ? "text" : "filled";
        btn.innerText = text;
        btn.onclick = fn;
        if (color) btn.style.color = color;
        dialog.appendChild(btn);
    }

    function renderOrderDetail(dialog, order, detailPushBtn, refundOrderVos) {
        const product = order.goodsOrderList?.[0] || {};
        state.currentDetailOrder = order;

        dialog.querySelectorAll('[slot="action"]').forEach(el => el.remove());

        if (order.payState === 0 || order.payState === 1) {
            addActionButton(dialog, "取消订单", () => {
                dialog.open = false;
                setTimeout(() => {
                    state.orderToCancel = order.shopOrderNumber;
                    els.confirmDialog.open = true;
                }, 200);
            }, "rgb(var(--mdui-color-error))");
        }

        if (order.payState === 2) {
            state.orderToPush = order;
            detailPushBtn.style.display = 'inline-flex';

            const queuedData = findOrderInQueue(order.ccbPayOrderNumber);
            if (queuedData && queuedData.item && queuedData.item.buyerMobile) {
                detailPushBtn.innerText = "可补推送";
                state.orderToPush._cachedMobile = queuedData.item.buyerMobile;
                state.orderToPush._storeKey = queuedData.storeKey;
            } else {
                detailPushBtn.innerText = "补推送";
                state.orderToPush._cachedMobile = "";
                state.orderToPush._storeKey = "";
            }

            addActionButton(dialog, "退款", () => {
                dialog.open = false;
                setTimeout(() => {
                    state.orderToRefund = order.ccbPayOrderNumber;
                    els.refundDialog.open = true;
                }, 200);
            }, "rgb(var(--mdui-color-error))");
        }

        addActionButton(dialog, "关闭", () => dialog.open = false);

        const content = document.getElementById('detailContent');
        content.innerHTML = renderOrderDetailContent(order, product, refundOrderVos);
        content.style.display = 'grid';
    }

    function renderOrderDetailContent(order, product, refundOrderVos) {
        const itemHtml = (l, v, full = false) => `<div class="detail-item ${full ? 'detail-full-width' : ''}"><span class="detail-label">${escapeHtml(l)}</span><span class="detail-value">${escapeHtml(v || '-')}</span></div>`;

        const price = Number(order.shopActualPayPrice || 0).toFixed(2);
        const statusText = payStates[order.payState] || '未知';
        const shortAddr = (() => {
            const addr = order.address || '';
            const parts = addr.split('-');
            return parts.length > 2 ? parts.slice(2).join('-').trim() || addr : addr;
        })();
        const goodsModel = product.goodsModel || product.goodsName || '';
        const recordText = order.recordState != null ? (recordStates[order.recordState] || order.recordState) : '';

        return `
            <div class="detail-summary-card">
                <div class="detail-summary-top">
                    <div class="detail-summary-identity">
                        <span class="detail-summary-name">${escapeHtml(order.buyerName || order.buyerMobile || '-')}</span>
                        <span class="detail-summary-phone">${escapeHtml(order.buyerMobile || '')}</span>
                    </div>
                    <button class="fill-order-detail-btn compact-btn">填入</button>
                </div>
                <div class="detail-summary-row detail-summary-full">
                    <span class="detail-summary-label">地址</span>
                    <span class="detail-summary-value">${escapeHtml(shortAddr || '-')}</span>
                </div>
                <div class="detail-summary-row detail-summary-full">
                    <span class="detail-summary-label">型号</span>
                    <span class="detail-summary-value">${escapeHtml(goodsModel || '-')}</span>
                </div>
                <div class="detail-summary-price">
                    <span class="detail-summary-price-value">¥${escapeHtml(price)}</span>
                    <span class="status-badge status-${order.payState}" style="margin-left:auto;">${escapeHtml(statusText)}</span>
                </div>
                ${recordText ? `<div class="detail-summary-row"><span class="detail-summary-label">核验</span><span class="detail-summary-value">${escapeHtml(recordText)}</span></div>` : ''}
            </div>

            ${(() => {
                const refundedList = [5, 8];
                if (!refundedList.includes(order.payState) || !Array.isArray(refundOrderVos) || !refundOrderVos.length) return '';
                return refundOrderVos.map(refundVo => {
                    const r = refundVo.buyerRefundOrder || {};
                    return `<details class="detail-collapse" open>
                        <summary>退款信息</summary>
                        <div class="detail-collapse-content">
                            ${itemHtml('建行退款单号', r.ccbRefundOrderNumber, true)}
                            ${itemHtml('门店退款单号', r.shopRefundOrderNumber, true)}
                            ${itemHtml('建行支付单号', r.ccbPayOrderNumber, true)}
                            ${itemHtml('顾客手机', r.buyerMobile)}
                            ${itemHtml('顾客姓名', r.buyerName)}
                            ${itemHtml('退款时间', r.createTime || '-', true)}
                        </div>
                    </details>`;
                }).join('');
            })()}

            <details class="detail-collapse">
                <summary>单号信息</summary>
                <div class="detail-collapse-content">
                    ${itemHtml('门店销售单号', order.shopOrderNumber)}
                    ${itemHtml('建行交易单号', order.ccbPayOrderNumber, true)}
                    ${itemHtml('下单时间', order.createTime || '-', true)}
                    ${itemHtml('支付时间', order.payTime || '未支付', true)}
                </div>
            </details>
            <details class="detail-collapse">
                <summary>商品信息</summary>
                <div class="detail-collapse-content">
                    ${itemHtml('品牌', product.brand)} ${itemHtml('商品分类', product.goodsType)}
                    ${itemHtml('商品编号', product.goodsCode || order.goodsCode || '-', true)}
                    ${itemHtml('商品型号', product.goodsModel, true)}
                </div>
            </details>
            <details class="detail-collapse">
                <summary>地址信息</summary>
                <div class="detail-collapse-content">
                    ${itemHtml('收货地址', order.address, true)}
                </div>
            </details>
            <details class="detail-collapse">
                <summary>金额明细</summary>
                <div class="detail-collapse-content">
                    ${itemHtml('开单原价', order.shopOriginalPrice != null ? '¥' + order.shopOriginalPrice : '-')}
                    ${itemHtml('政府补贴', order.subsidyTotalAmount != null ? '¥' + order.subsidyTotalAmount : '-')}
                    ${itemHtml('实付金额', '¥' + price, true)}
                </div>
            </details>
        `;
    }

    function parseOrderAddress(address) {
        if (!address) return { city: "", district: "", town: "", detail: "" };
        const parts = address.split('-').map(p => p.trim()).filter(p => p);
        let cityIdx = -1, distIdx = -1, townIdx = -1;
        let city = "", district = "", town = "";

        for (let i = 0; i < parts.length; i++) {
            if (state.regionTree[parts[i]]) {
                cityIdx = i;
                city = parts[i];
                break;
            }
        }
        if (cityIdx === -1) return { city: "", district: "", town: "", detail: address };

        for (let i = cityIdx + 1; i < parts.length; i++) {
            if (state.regionTree[city]?.[parts[i]]) {
                distIdx = i;
                district = parts[i];
                break;
            }
        }
        if (distIdx === -1) return { city, district: "", town: "", detail: parts.slice(cityIdx + 1).join('-') };

        const towns = state.regionTree[city][district] || [];
        for (let i = distIdx + 1; i < parts.length; i++) {
            const matched = towns.find(t => t.text === parts[i] || t.text.includes(parts[i]));
            if (matched) {
                townIdx = i;
                town = matched.text;
                break;
            }
        }

        const detailStart = townIdx !== -1 ? townIdx + 1 : distIdx + 1;
        return { city, district, town, detail: parts.slice(detailStart).join('-') };
    }

    async function fillOrderToForm() {
        const order = state.currentDetailOrder;
        if (!order) return;

        const product = order.goodsOrderList?.[0] || {};

        const addrParts = parseOrderAddress(order.address || "");
        applyParsedAddress({
            mobile: "",
            city: addrParts.city,
            district: addrParts.district,
            town: addrParts.town,
            detail: addrParts.detail
        });

        const goodsCode = product.goodsCode || order.goodsCode || "";
        if (goodsCode) {
            document.querySelector('#goodsCode').value = goodsCode;
            await queryGoodsInfo();
            if (order.shopOriginalPrice) {
                document.querySelector('#shopPrice').value = order.shopOriginalPrice;
                calcPrice();
            }
        }

        els.detailDialog.open = false;
        document.getElementById('orderDrawer').open = false;
        showSnackbar({ message: "已填入订单信息" });
    }

    async function cancelOrder() {
        if (!state.orderToCancel) return;
        els.confirmDialog.open = false;
        addLog(`请求取消订单: ${state.orderToCancel}`, "info");
        const res = await callApi('/salesuser/cancelWxMiniOrder', 'POST', { shopOrderNumber: state.orderToCancel });
        if (res?.code === 0) {
            addLog("订单取消成功", "info");
            showSnackbar({ message: "订单取消成功！" });
            fetchOrders();
        } else {
            addLog(`订单取消失败: ${res?.msg}`, "error");
            showError(res?.msg || "取消失败");
        }
        state.orderToCancel = "";
    }

    function closeConfirmDialog() {
        els.confirmDialog.open = false;
        state.orderToCancel = "";
    }

    async function refundOrder() {
        if (!state.orderToRefund) return;
        els.refundDialog.open = false;

        addLog(`请求发起退款: ${state.orderToRefund}`, "info");
        const payload = {
            shopRefundOrderNumber: "",
            ccbPayOrderNumber: state.orderToRefund,
            goodsList: []
        };

        const res = await callApi('/salesuser/auditRefundOrder', 'POST', payload);

        if (res?.code === 0) {
            addLog("退款请求已接受", "info");
            showSnackbar({ message: "退款成功" });

            const detailRes = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber: state.orderToRefund });
            if (detailRes?.code === 0 && detailRes.data) {
                addLog("获取退款详情成功，准备发起钉钉推送", "info");
                const msg = buildDingTalkRefundMessage(detailRes.data);
                await sendDingTalkMessage(msg);
            }

            fetchOrders();
        } else {
            addLog(`退款请求失败: ${res?.msg}`, "error");
            showError(res?.msg || "退款请求失败");
        }
        state.orderToRefund = "";
    }

    function closeRefundDialog() {
        els.refundDialog.open = false;
        state.orderToRefund = "";
    }

    function openDetailPushDialog() {
        if (!state.orderToPush) {
            return showSnackbar({ message: "当前订单不支持补推送" });
        }
        els.detailDialog.open = false;
        setTimeout(() => {
            els.pushDialog.open = true;
            if (state.orderToPush._cachedMobile) {
                els.pushMobileInput.value = state.orderToPush._cachedMobile;
            } else {
                els.pushMobileInput.value = "";
            }
        }, 200);
    }

    async function confirmPush() {
        const pushMobile = els.pushMobileInput.value.trim();

        if (!state.orderToPush) return;
        if (!pushMobile) {
            return showSnackbar({ message: "手机号不能为空" });
        }
        if (pushMobile.includes('*')) {
            return showSnackbar({ message: "手机号不能包含*号" });
        }
        if (!/^1[3-9]\d{9}$/.test(pushMobile)) {
            return showSnackbar({ message: "请输入正确的手机号" });
        }

        addLog(`手动补发推送: ${state.orderToPush.shopOrderNumber} -> ${pushMobile}`, "info");
        const msg = buildDingTalkOrderMessage(state.orderToPush, pushMobile);
        await sendDingTalkMessage(msg);
        showSnackbar({ message: "推送请求已发送" });

        const storeKey = state.orderToPush._storeKey || getCurrentStoreKey();
        const orderNumber = state.orderToPush.ccbPayOrderNumber;
        if (orderNumber) {
            dequeueOrder(storeKey, orderNumber);
            markOrderPushed(storeKey, orderNumber, "PAID");
            addLog(`已将订单[${orderNumber}]从本地轮询队列中移除`, "info");
        }

        closePushDialog();
    }

    function closePushDialog() {
        els.pushDialog.open = false;
        els.pushMobileInput.value = "";
        state.orderToPush = null;
    }

    function openQrDialog(ccbOrderNum) {
        if (!ccbOrderNum) return showSnackbar({ message: "无效的订单号" });
        state.currentQrOrderNumber = ccbOrderNum;
        els.qrDialog.open = true;
        loadQrCode();
    }

    function refreshQrCode() {
        if (state.currentQrOrderNumber) loadQrCode();
    }

    async function loadQrCode() {
        els.qrLoading.style.display = 'block';
        els.qrImage.style.display = 'none';
        els.qrImage.src = '';

        addLog(`正在获取订单[${state.currentQrOrderNumber}]的支付二维码...`, "info");
        const res = await callApi('/salesuser/getCcbTogetherPayQrCd', 'POST', {
            ccbPayOrderNumber: state.currentQrOrderNumber
        });

        els.qrLoading.style.display = 'none';

        if (res?.code === 0 && res.data?.paymentQrCode) {
            const base64Str = res.data.paymentQrCode;
            const src = base64Str.startsWith('data:') ? base64Str : `data:image/png;base64,${base64Str}`;
            els.qrImage.src = src;
            els.qrImage.style.display = 'block';
        } else {
            addLog(`获取二维码失败: ${res?.msg}`, "error");
            showSnackbar({ message: res?.msg || "获取二维码失败" });
        }
    }

    async function copyQrImage() {
        const src = els.qrImage.src;
        if (!src || els.qrImage.style.display === 'none') return showSnackbar({ message: "二维码未加载" });

        try {
            const response = await fetch(src);
            const blob = await response.blob();
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
            showSnackbar({ message: "二维码图片已复制" });
        } catch (err) {
            console.error(err);
            showSnackbar({ message: "复制失败，请手动长按保存" });
        }
    }

    async function checkSncode() {
        const sncode = document.querySelector('#sncode').value;
        if (!sncode) return showError("请输入sn码");
        if (!state.currentToken) return showError("系统未就绪");

        addLog(`查询SN码: ${sncode}`, "info");
        const res = await callApi('/salesuser/querySnState', 'GET', { snCode: sncode });

        if (res?.code === 0) {
            addLog(`SN查询结果: ${res?.data.saleState}`, "info");
            showError(res?.data.saleState + " " + res?.data.detail);
        } else {
            addLog(`SN查询异常: ${res?.msg}`, "error");
            showError(res?.msg || "查询无响应");
        }
    }

    async function checkQualification() {
        const mobileField = document.getElementById('buyerMobile');
        const mobile = mobileField.value;
        mobileField.setCustomValidity('');
        if (!mobile) {
            mobileField.setCustomValidity('请输入手机号');
            mobileField.reportValidity();
            return;
        }
        if (!state.currentToken) {
            mobileField.setCustomValidity('系统未就绪');
            mobileField.reportValidity();
            return;
        }

        addLog(`校验买家资格: ${mobile}`, "info");
        const res = await callApi('/salesuser/queryCustomerChannelSubsidyBalance', 'GET', { buyerMobile: mobile });
        const chips = document.querySelectorAll('#productCategoryChips mdui-chip');

        chips.forEach(c => {
            if (!c.dataset.originalText) c.dataset.originalText = c.textContent;
        });

        if (res?.code === 0) {
            addLog(`资格查询成功，返点Code: ${res.data.countrySubsidyCateCodes || '无'}`, "info");
            const validCodes = (res.data.countrySubsidyCateCodes || "").split(',').map(c => c.trim()).filter(c => c);
            const cityMap = {};
            (res.data.cateCodeList || []).forEach(item => {
                if (item.cityName) cityMap[item.cateCode] = item;
            });
            chips.forEach(c => {
                c.selected = validCodes.includes(c.value);
                if (cityMap[c.value]) {
                    const { cityName, mode } = cityMap[c.value];
                    const city = cityName.slice(0, -1);
                    const modeText = mode === '0' ? '线上' : '线下';
                    c.textContent = c.dataset.originalText + '（' + city + modeText + '）';
                } else {
                    c.textContent = c.dataset.originalText;
                }
            });
            sortSelectedChipsToTop();

            if (validCodes.length > 0) {
                showSnackbar({ message: `查询成功`, closeable: true });
                stopRemindPolling();
                showRemindBtn(false);
            } else {
                showSnackbar({ message: `查询成功，尚未领取品类资格`, closeable: true });
                chips.forEach(c => {
                    c.selected = false;
                    c.textContent = c.dataset.originalText;
                });
                showRemindBtn(true);
            }
        } else {
            const errMsg = res?.msg || "查询无响应";
            addLog(`资格查询失败: ${errMsg}`, "error");
            mobileField.setCustomValidity(errMsg);
            mobileField.reportValidity();
            chips.forEach(c => {
                c.selected = false;
                c.textContent = c.dataset.originalText;
            });
            showRemindBtn(true);
        }
    }

    function showRemindBtn(show) {
        const btn = document.getElementById('remindQualificationBtn');
        btn.style.display = show ? 'inline-flex' : 'none';
    }

    function stopRemindPolling() {
        if (state.remindPollTimer) {
            clearInterval(state.remindPollTimer);
            state.remindPollTimer = null;
        }
        state.isRemindPolling = false;
        const btn = document.getElementById('remindQualificationBtn');
        btn.innerHTML = '等待领卷';
        btn.disabled = false;
    }

    function startRemindPolling() {
        if (state.isRemindPolling) return;
        const mobile = document.getElementById('buyerMobile').value.trim();
        if (!mobile || !state.currentToken) return;

        state.isRemindPolling = true;
        const btn = document.getElementById('remindQualificationBtn');
        btn.innerHTML = '<mdui-circular-progress style="width:16px;height:16px;margin-right:4px;"></mdui-circular-progress>轮询中';
        btn.disabled = true;
        addLog(`开始轮询资格核验[${mobile}]`, "info");

        state.remindPollTimer = setInterval(async () => {
            const currentMobile = document.getElementById('buyerMobile').value.trim();
            if (currentMobile !== mobile) {
                stopRemindPolling();
                showRemindBtn(false);
                return;
            }

            addLog(`轮询资格核验: ${mobile}`, "info");
            const res = await callApi('/salesuser/queryCustomerChannelSubsidyBalance', 'GET', { buyerMobile: mobile });

            if (res?.code === 0) {
                const validCodes = (res.data.countrySubsidyCateCodes || "").split(',').map(c => c.trim()).filter(c => c);
                if (validCodes.length > 0) {
                    addLog(`资格核验轮询成功，已获得品类`, "info");
                    stopRemindPolling();
                    showRemindBtn(false);
                    const chips = document.querySelectorAll('#productCategoryChips mdui-chip');
                    const cityMap = {};
                    (res.data.cateCodeList || []).forEach(item => {
                        if (item.cityName) cityMap[item.cateCode] = item;
                    });
                    chips.forEach(c => {
                        if (!c.dataset.originalText) c.dataset.originalText = c.textContent;
                        c.selected = validCodes.includes(c.value);
                        if (cityMap[c.value]) {
                            const { cityName, mode } = cityMap[c.value];
                            const city = cityName.slice(0, -1);
                            const modeText = mode === '0' ? '线上' : '线下';
                            c.textContent = c.dataset.originalText + '（' + city + modeText + '）';
                        } else {
                            c.textContent = c.dataset.originalText;
                        }
                    });
                    sortSelectedChipsToTop();
                    document.getElementById('remindSuccessDialog').open = true;
                }
            }
        }, 1000);
    }

    function sortSelectedChipsToTop() {
        const container = document.getElementById('productCategoryChips');
        const chips = Array.from(container.querySelectorAll('mdui-chip'));
        const selected = chips.filter(c => c.selected);
        const unselected = chips.filter(c => !c.selected);
        container.innerHTML = '';
        selected.forEach(c => container.appendChild(c));
        unselected.forEach(c => container.appendChild(c));
    }

    function toggleChipExpand() {
        const container = document.getElementById('productCategoryChips');
        const btn = document.getElementById('chipExpandBtn');
        const isCollapsed = container.classList.contains('collapsed');
        if (isCollapsed) {
            container.classList.remove('collapsed');
            btn.innerText = '收起';
        } else {
            container.classList.add('collapsed');
            btn.innerText = '展开全部';
        }
    }

    async function queryGoodsInfo() {
        const code = document.querySelector('#goodsCode').value;
        if (!code || !state.currentToken) {
            _pendingGoodsQuery = null;
            return;
        }

        addLog(`查询商品信息: ${code}`, "info");
        _pendingGoodsQuery = callApi('/salesuser/queryGoodsInfo', 'GET', { goodsCode: code, uniscid: "" });
        try {
            const res = await _pendingGoodsQuery;
            if (res?.code === 0 && res.data) {
                if (res.data.id == null) {
                    addLog(`商品[${code}]未备案或已吊销`, "error");
                    showError(`商品未备案或已吊销`);
                    document.querySelector('#goodsCode').dataset.goodsName = "";
                    document.querySelector('#filingPrice').value = "";
                    document.querySelector('#shopPrice').value = "";
                    renderRecentGoodsSelect("");
                    return;
                }
                document.querySelector('#goodsCode').dataset.goodsName = res.data.goodsName;
                saveRecentGoods(code, res.data.goodsName);
                document.querySelector('#filingPrice').value = res.data.subsidyBackPrice;

                const price = parseFloat(res.data.subsidyBackPrice);
                if (price > 10000) {
                    const maxFloat = Math.min(price - 10000, 1000);
                    const float = Math.floor(Math.random() * (maxFloat + 1));
                    document.querySelector('#shopPrice').value = formatPrice(10000 + float);
                } else {
                    document.querySelector('#shopPrice').value = res.data.subsidyBackPrice;
                }

                calcPrice();
            } else {
                addLog(`商品[${code}]查询失败`, "error");
                showError(`商品查询失败: ${res?.msg}`);
                document.querySelector('#goodsCode').dataset.goodsName = "";
                renderRecentGoodsSelect("");
            }
        } finally {
            _pendingGoodsQuery = null;
        }
    }

    let _calcGuard = false;
    let _pendingGoodsQuery = null;

    function formatPrice(v) {
        const n = Math.round(v * 100) / 100;
        return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
    }

    function calcPrice() {
        if (_calcGuard) return;
        let shopPrice = parseFloat(document.querySelector('#shopPrice').value);
        if (isNaN(shopPrice)) return;

        const filingPrice = parseFloat(document.querySelector('#filingPrice').value);
        if (!isNaN(filingPrice) && filingPrice > 0 && shopPrice > filingPrice) {
            shopPrice = filingPrice;
            document.querySelector('#shopPrice').value = formatPrice(shopPrice);
        }

        let actualPrice;
        if (shopPrice <= 10000) {
            actualPrice = shopPrice * 0.85;
        } else {
            actualPrice = 8500 + (shopPrice - 10000);
        }

        _calcGuard = true;
        document.querySelector('#actualPrice').value = formatPrice(actualPrice);
        document.querySelector('#subsidyPrice').value = formatPrice(shopPrice - actualPrice);
        _calcGuard = false;
    }

    function reverseCalcPrice() {
        if (_calcGuard) return;
        const actualPrice = parseFloat(document.querySelector('#actualPrice').value);
        if (isNaN(actualPrice)) return;

        let shopPrice;
        if (actualPrice <= 8500) {
            shopPrice = actualPrice / 0.85;
        } else {
            shopPrice = 10000 + (actualPrice - 8500);
        }

        const filingPrice = parseFloat(document.querySelector('#filingPrice').value);
        if (!isNaN(filingPrice) && filingPrice > 0 && shopPrice > filingPrice) {
            shopPrice = filingPrice;
        }

        _calcGuard = true;
        document.querySelector('#shopPrice').value = formatPrice(shopPrice);
        document.querySelector('#subsidyPrice').value = formatPrice(shopPrice - actualPrice);
        _calcGuard = false;
    }

    async function generateNextOrderNumber() {
        const tradeMonth = getDefaultTradeMonth();
        const res = await callApi('/salesuser/getShopOrderList', 'GET', {
            tradeMonth: tradeMonth, inputStr: "", pageNumber: "1"
        });
        if (res?.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
            const num = parseInt(res.data[0].shopOrderNumber, 10);
            return Number.isNaN(num) ? "1" : (num + 1).toString();
        }
        return "1";
    }

    async function submitOrder() {
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }

        if (!state.currentToken) return showError("Token 未就绪");

        if (_pendingGoodsQuery) {
            addLog("等待商品信息查询完成...", "info");
            try { await _pendingGoodsQuery; } catch (_) { /* 查询异常已在 queryGoodsInfo 中处理 */ }
        }

        addLog("开始收集表单并提交订单...", "info");
        const mobile = document.querySelector('#buyerMobile').value;
        const goodsCode = document.querySelector('#goodsCode').value;
        const shopPrice = document.querySelector('#shopPrice').value;
        const actual = document.querySelector('#actualPrice').value;
        const subsidy = document.querySelector('#subsidyPrice').value;
        const detailAddr = document.querySelector('#detailAddress').value;
        const city = els.city.value;
        const district = els.district.value;
        const townCode = els.town.value;

        const actualGoodsName = document.querySelector('#goodsCode').dataset.goodsName || "";

        if (!mobile || !goodsCode || !shopPrice || !city || !district || !townCode || !actualGoodsName) {
            return showError("请填写完整订单信息（注意确认商品查询成功及乡镇地址）");
        }

        let shopOrderNum = document.querySelector('#shopOrderNumber').value;
        if (document.querySelector('#autoOrderNumCheckbox').checked) {
            try {
                showSnackbar({ message: "正在获取最新单号..." });
                shopOrderNum = await generateNextOrderNumber();
            } catch (e) {
                return showError("自动获取单号失败");
            }
        }

        let townName = "";
        const townItem = els.town.querySelector(`mdui-menu-item[value="${townCode}"]`);
        if (townItem) townName = townItem.innerText;
        else if (state.regionTree[city]?.[district]) {
            const t = state.regionTree[city][district].find(x => x.value == townCode);
            if (t) townName = t.text;
        }

        const addressStr = `${city}-${district}-${townName}-${detailAddr}`;

        const buyerName = document.querySelector('#buyerName').value.trim();

        const payload = {
            shopOrderNumber: shopOrderNum,
            buyerMobile: mobile,
            shopActualPayPrice: parseFloat(actual || 0).toFixed(2),
            shopOriginalPrice: parseFloat(shopPrice).toFixed(2),
            subsidyTotalAmount: parseFloat(subsidy || 0).toFixed(2),
            goodsVoList: [{
                goodsCode,
                goodsName: actualGoodsName,
                goodsCount: 1,
                shopGoodsActualPayPrice: parseFloat(actual || 0),
                shopGoodsOriginalPrice: parseFloat(shopPrice),
                subsidyAmount: parseFloat(subsidy || 0),
                uniscid: ""
            }],
            buyerName,
            uniscid: "",
            address: addressStr,
            townCode
        };

        addLog(`订单详情: [${shopOrderNum}] 实付:${actual} 买家:${mobile} 地址:${addressStr.slice(0, 10)}...`, "info");
        const res = await callApi('/salesuser/addOrder', 'POST', payload);
        if (res?.code === 0) {
            addLog(`下单成功: 建行单号为 ${res.data}`, "info");
            showSnackbar({ message: "订单提交成功！" });
            if (res.data) {
                openQrDialog(res.data);

                const storeKey = getCurrentStoreKey();
                enqueueOrder(storeKey, res.data, {
                    lastState: 0,
                    buyerMobile: mobile,
                    createdAt: Date.now(),
                    lastCheckAt: 0
                });

                checkNowAndEnsurePolling("submitOrder");
            }

        } else {
            addLog(`提交订单失败: ${res?.msg}`, "error");
            showError(res?.msg || "提交失败");
        }
    }

    async function smartParse() {
        const raw = document.querySelector('#smartInput').value;
        if (!raw.trim()) return showSnackbar({ message: "请先输入文本" });
        if (!Object.keys(state.regionTree).length) return showSnackbar({ message: "地址库未加载" });

        if (state.aiEnable && state.aiEndpoint && state.aiModel && state.aiKey) {
            await aiSmartParse(raw);
        } else {
            regexSmartParse(raw);
        }
    }

    async function aiSmartParse(raw) {
        addLog("使用 AI 大模型进行地址智能解析...", "info");
        const loadingSnackbar = showSnackbar({ message: "AI 正在识别...", duration: 0 });

        try {
            const systemPrompt = `你是一个地址解析助手。请从用户输入的文本中提取出手机号、城市、区县、乡镇/街道、详细地址、商品编码、姓名。
严格返回JSON格式，不要返回任何其他说明或Markdown标记。
必须包含以下字段：
{
  "mobile": "手机号码，11位数字，若无则为空字符串",
  "city": "地级市名称，如'常州市'，需包含市等后缀，若无则为空",
  "district": "区县名称，如'武进区'，若无则为空",
  "town": "乡镇或街道名称，如'南夏墅街道'，若无则为空",
  "detail": "剔除上述省市区镇、手机号和商品编码后的剩余详细地址，只能是地址，不能包含其他杂乱信息",
  "goodsCode": "商品编码，以69开头的大于等于10位的连续数字，如'6912345678901'，若无则为空字符串；如果出现多个候选，选择最长的一个",
  "name": "买家姓名，2-4个中文字，若无则为空字符串"
}`;

            const response = await fetch(state.aiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.aiKey}`
                },
                body: JSON.stringify({
                    model: state.aiModel,
                    thinking: { type: "disabled" },
                    stream: false,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: raw }
                    ],
                    temperature: 0.1
                })
            });

            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error?.message || "请求失败");
            }

            const content = data.choices[0].message.content;
            addLog(`AI 原生响应: ${content}`, "info");

            let jsonStr = content;
            const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) {
                jsonStr = match[1];
            }

            const result = JSON.parse(jsonStr);

            if (loadingSnackbar) loadingSnackbar.open = false;
            showSnackbar({ message: "AI 识别成功" });
            applyParsedAddress(result);

        } catch (e) {
            if (loadingSnackbar) loadingSnackbar.open = false;
            addLog(`AI 解析异常: ${e.message}`, "error");
            showSnackbar({ message: `AI 解析失败，降级使用常规解析` });
            regexSmartParse(raw);
        }
    }

    function applyParsedAddress(parsed) {
        let { mobile, city, district, town, detail, goodsCode, name } = parsed;

        if (mobile && /^1[3-9]\d{9}$/.test(mobile)) {
            document.querySelector('#buyerMobile').value = mobile;
            checkQualification();
        }

        if (name && /^[\u4e00-\u9fa5]{2,4}$/.test(name)) {
            document.querySelector('#buyerName').value = name;
        }

        let matchedCity = "";
        let matchedDist = "";
        let matchedTownCode = "";

        const normalize = (str) => (str || "").replace(/[市区县镇乡街道]/g, "");

        if (city) {
            for (const cKey in state.regionTree) {
                if (cKey === city || cKey.includes(normalize(city))) {
                    matchedCity = cKey;
                    break;
                }
            }
        }

        if (matchedCity && district) {
            for (const dKey in state.regionTree[matchedCity]) {
                if (dKey === district || dKey.includes(normalize(district))) {
                    matchedDist = dKey;
                    break;
                }
            }
        } else if (!matchedCity && district) {
            for (const cKey in state.regionTree) {
                for (const dKey in state.regionTree[cKey]) {
                    if (dKey === district || dKey.includes(normalize(district))) {
                        matchedCity = cKey;
                        matchedDist = dKey;
                        break;
                    }
                }
                if (matchedCity) break;
            }
        }

        if (matchedCity && matchedDist && town) {
            const towns = state.regionTree[matchedCity][matchedDist] || [];
            for (const t of towns) {
                if (t.text === town || t.text.includes(normalize(town)) || normalize(town).includes(normalize(t.text))) {
                    matchedTownCode = t.value;
                    break;
                }
            }
        }

        if (matchedCity) {
            addLog(`AI地址匹配结果: ${matchedCity}-${matchedDist}-${matchedTownCode}`, "info");
            els.city.value = matchedCity;
            setTimeout(() => {
                populateSelect(els.district, Object.keys(state.regionTree[matchedCity]), matchedDist);
                setTimeout(() => {
                    const towns = matchedDist ? (state.regionTree[matchedCity][matchedDist] || []) : [];
                    populateSelect(els.town, towns, matchedTownCode);
                }, 100);
            }, 50);
        } else {
            showSnackbar({ message: "解析成功，但在地址库中未能精确匹配省市区" });
        }

        if (detail) {
            document.querySelector('#detailAddress').value = detail;
        }

        if (goodsCode && /^69\d{8,}$/.test(goodsCode)) {
            document.querySelector('#goodsCode').value = goodsCode;
            if (state.currentToken) {
                setTimeout(() => queryGoodsInfo(), 100);
            }
        }
    }

    function regexSmartParse(raw) {
        addLog("开始正则解析文本地址", "info");
        const escapeRegExp = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const normalizeName = (name = "") => name.replace(/[市区县]$/, "");
        const hasToken = (text, fullName) => {
            if (!fullName) return false;
            const simple = normalizeName(fullName);
            return text.includes(fullName) || (simple.length >= 2 && text.includes(simple));
        };

        let mobile = "";
        const phoneMatch = raw.match(/1[3-9]\d{9}/);
        if (phoneMatch) {
            mobile = phoneMatch[0];
            document.querySelector('#buyerMobile').value = mobile;
            checkQualification();
        }

        let goodsCode = "";
        const goodsCodeMatch = raw.match(/69\d{8,}/);
        if (goodsCodeMatch) {
            goodsCode = goodsCodeMatch[0];
            document.querySelector('#goodsCode').value = goodsCode;
            if (state.currentToken) {
                setTimeout(() => queryGoodsInfo(), 100);
            }
        }

        let buyerName = "";
        let nameStripped = raw;
        if (mobile) nameStripped = nameStripped.replace(new RegExp(escapeRegExp(mobile), "g"), "");
        if (goodsCode) nameStripped = nameStripped.replace(new RegExp(escapeRegExp(goodsCode), "g"), "");
        const nameMatch = nameStripped.match(/([\u4e00-\u9fa5]{2,4})/);
        if (nameMatch) {
            const candidate = nameMatch[1];
            const addrKeywords = /[市区县镇乡街道村路巷弄号楼幢室栋单元层座室号栋室]/;
            const isAddress = candidate.length > 1 && addrKeywords.test(candidate);
            if (!isAddress) {
                buyerName = candidate;
                document.querySelector('#buyerName').value = buyerName;
            }
        }

        let matched = { city: "", dist: "", townCode: "", townName: "" };

        const textIndex = {};
        for (const cKey in state.regionTree) {
            for (const dKey in state.regionTree[cKey]) {
                const towns = state.regionTree[cKey][dKey] || [];
                for (const t of towns) {
                    const text = t?.text;
                    if (!text) continue;
                    if (!textIndex[text]) textIndex[text] = [];
                    textIndex[text].push({ city: cKey, dist: dKey, townCode: t.value, townName: text });
                }
            }
        }

        const townCandidates = [];
        for (const townText in textIndex) {
            if (raw.includes(townText)) {
                for (const loc of textIndex[townText]) {
                    let score = 10;
                    if (raw.includes(loc.dist)) score += 6;
                    else if (hasToken(raw, loc.dist)) score += 4;
                    if (raw.includes(loc.city)) score += 3;
                    else if (hasToken(raw, loc.city)) score += 2;
                    townCandidates.push({ ...loc, score });
                }
            }
        }

        if (townCandidates.length) {
            townCandidates.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (b.townName.length !== a.townName.length) return b.townName.length - a.townName.length;
                return 0;
            });
            matched = townCandidates[0];
        } else {
            let bestDistrict = null;
            for (const cKey in state.regionTree) {
                for (const dKey in state.regionTree[cKey]) {
                    if (hasToken(raw, dKey)) {
                        let score = 6;
                        if (raw.includes(dKey)) score += 2;
                        if (hasToken(raw, cKey)) score += 2;
                        if (!bestDistrict || score > bestDistrict.score) {
                            bestDistrict = { city: cKey, dist: dKey, score };
                        }
                    }
                }
            }

            if (bestDistrict) {
                matched.city = bestDistrict.city;
                matched.dist = bestDistrict.dist;
            } else {
                for (const cKey in state.regionTree) {
                    if (hasToken(raw, cKey)) {
                        matched.city = cKey;
                        break;
                    }
                }
            }
        }

        if (matched.city) {
            addLog(`正则解析结果: ${matched.city}-${matched.dist}-${matched.townName}`, "info");
            els.city.value = matched.city;
            setTimeout(() => {
                populateSelect(els.district, Object.keys(state.regionTree[matched.city]), matched.dist);
                setTimeout(() => {
                    const towns = matched.dist ? (state.regionTree[matched.city][matched.dist] || []) : [];
                    populateSelect(els.town, towns, matched.townCode);
                }, 100);
            }, 50);
        } else {
            showSnackbar({ message: "未识别到地址信息" });
        }

        let addr = raw;
        if (mobile) addr = addr.replace(new RegExp(escapeRegExp(mobile), "g"), "");
        if (goodsCode) addr = addr.replace(new RegExp(escapeRegExp(goodsCode), "g"), "");
        if (matched.townName) addr = addr.replace(new RegExp(escapeRegExp(matched.townName), "g"), "");
        if (matched.dist) {
            addr = addr.replace(new RegExp(escapeRegExp(matched.dist), "g"), "");
            const simpleDist = normalizeName(matched.dist);
            if (simpleDist.length >= 2 && simpleDist !== matched.dist) {
                addr = addr.replace(new RegExp(escapeRegExp(simpleDist), "g"), "");
            }
        }
        if (matched.city) {
            addr = addr.replace(new RegExp(escapeRegExp(matched.city), "g"), "");
            const simpleCity = normalizeName(matched.city);
            if (simpleCity.length >= 2 && simpleCity !== matched.city) {
                addr = addr.replace(new RegExp(escapeRegExp(simpleCity), "g"), "");
            }
        }

        addr = addr
            .replace(/^[\s\-—_,，。;；、\/]+/, "")
            .replace(/[\s\-—_,，。;；、\/]+/g, " ")
            .trim();

        document.querySelector('#detailAddress').value = addr;
    }

    // ==================== 商品池文件缓存（IndexedDB） ====================
    const POOL_CACHE_DB = 'ProductPoolCache';
    const POOL_CACHE_STORE = 'blobs';

    function openPoolCacheDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(POOL_CACHE_DB, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(POOL_CACHE_STORE, { keyPath: 'url' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function loadCachedPoolBlob(url) {
        try {
            const db = await openPoolCacheDB();
            const tx = db.transaction(POOL_CACHE_STORE, 'readonly');
            const store = tx.objectStore(POOL_CACHE_STORE);
            const result = await new Promise((resolve, reject) => {
                const req = store.get(url);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return result ? result.blob : null;
        } catch (e) {
            return null;
        }
    }

    async function savePoolBlobToCache(url, blob) {
        try {
            const db = await openPoolCacheDB();
            const tx = db.transaction(POOL_CACHE_STORE, 'readwrite');
            tx.objectStore(POOL_CACHE_STORE).put({ url, blob, timestamp: Date.now() });
            await new Promise(resolve => { tx.oncomplete = resolve; });
            db.close();
        } catch (e) {
            addLog('缓存商品池失败: ' + e.message, 'warn');
        }
    }

    // ==================== 商品 Excel 搜索模块 ====================
    const ProductSearch = (() => {
        let allSheetData = {};
        let allSheetHeaders = {};
        let sheetNames = [];
        let currentSheet = "";
        let lastSheetName = "";         // 记住上次选的工作表（当前会话）
        let fuseInstance = null;
        let currentItems = [];
        let libsLoaded = false;
        let savedHandle = null;
        let currentFileName = "";
        let dataLoaded = false;
        let poolDownloaded = false;

        const DB_NAME = 'ProductFileDB';
        const DB_STORE = 'handles';
        const DB_KEY = 'lastExcel';

        const $ = id => document.getElementById(id);

        function loadScript(url) {
            return new Promise((resolve, reject) => {
                if (document.querySelector(`script[data-url="${url}"]`)) return resolve();
                const s = document.createElement('script');
                s.src = url;
                s.dataset.url = url;
                s.onload = resolve;
                s.onerror = () => reject(new Error('无法加载 ' + url));
                document.head.appendChild(s);
            });
        }

        let _libsLoading = null;

        async function ensureLibs() {
            if (libsLoaded) return;
            if (_libsLoading) return _libsLoading;
            _libsLoading = Promise.all([
                loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'),
                loadScript('https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js')
            ]).then(() => {
                libsLoaded = true;
                _libsLoading = null;
            }).catch(err => {
                _libsLoading = null;
                throw err;
            });
            return _libsLoading;
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = String(str || '');
            return div.innerHTML;
        }

        function findField(item, candidates) {
            for (const c of candidates) {
                const cl = c.toLowerCase();
                for (const key of Object.keys(item)) {
                    if (key.toLowerCase().includes(cl) && item[key] != null && String(item[key]).trim()) {
                        return String(item[key]).trim();
                    }
                }
            }
            for (const key of Object.keys(item)) {
                if (item[key] != null && String(item[key]).trim()) return String(item[key]).trim();
            }
            return '';
        }

        // ---- IndexedDB 持久化 FileSystemFileHandle ----
        function openDB() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function saveHandleToDB(handle) {
            try {
                const db = await openDB();
                const tx = db.transaction(DB_STORE, 'readwrite');
                tx.objectStore(DB_STORE).put(handle, DB_KEY);
                await new Promise(r => { tx.oncomplete = r; });
                db.close();
            } catch (e) {}
        }

        async function loadHandleFromDB() {
            try {
                const db = await openDB();
                const tx = db.transaction(DB_STORE, 'readonly');
                const handle = await new Promise(r => {
                    const req = tx.objectStore(DB_STORE).get(DB_KEY);
                    req.onsuccess = () => r(req.result);
                    req.onerror = () => r(null);
                });
                db.close();
                return handle || null;
            } catch (e) { return null; }
        }

        async function tryRecoverSavedFile() {
            const handle = await loadHandleFromDB();
            if (!handle) return null;

            let perm = await handle.queryPermission({ mode: 'read' });
            if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
            if (perm !== 'granted') { await saveHandleToDB(null); return null; }

            try {
                const file = await handle.getFile();
                if (!file) return null;
                savedHandle = handle;
                addLog('自动恢复上次文件: ' + file.name, 'info');
                return file;
            } catch (e) {
                addLog('上次文件不可访问，请重新选择', 'warn');
                await saveHandleToDB(null);
                return null;
            }
        }

        // ---- Excel 解析 ----
        function parseFile(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        const buf = e.target.result;
                        addLog('正在解析: ' + file.name + ' (' + (buf.byteLength / 1024).toFixed(0) + ' KB)', 'info');
                        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
                        sheetNames = wb.SheetNames;
                        allSheetData = {};
                        allSheetHeaders = {};

                        for (const name of sheetNames) {
                            const ws = wb.Sheets[name];
                            const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
                            allSheetData[name] = rows;
                            const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
                            allSheetHeaders[name] = raw[0] ? raw[0].map(h => String(h || '').trim()) : [];
                        }

                        const total = Object.values(allSheetData).reduce((s, a) => s + a.length, 0);
                        addLog('解析完成: ' + sheetNames.length + ' 个工作表, 共 ' + total + ' 条', 'info');
                        resolve({ sheetNames, total });
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(new Error('文件读取失败'));
                reader.readAsArrayBuffer(file);
            });
        }

        // ---- 渲染工作表 Chips ----
        function renderSheetChips() {
            const container = $('psSheetChips');
            const wrapper = $('psSheetChipsWrap');
            const expandRow = $('psChipExpandRow');
            container.innerHTML = '';
            sheetNames.forEach(name => {
                const chip = document.createElement('mdui-chip');
                chip.variant = 'filter';
                chip.selectable = true;
                chip.dataset.sheet = name;
                chip.textContent = name + ' (' + allSheetData[name].length + ')';
                chip.addEventListener('click', () => {
                    container.querySelectorAll('mdui-chip').forEach(c => c.selected = false);
                    chip.selected = true;
                    selectSheet(name);
                });
                container.appendChild(chip);
            });
            wrapper.style.display = '';
            container.classList.add('collapsed');

            requestAnimationFrame(() => {
                if (container.scrollHeight > container.clientHeight + 2) {
                    expandRow.style.display = '';
                } else {
                    expandRow.style.display = 'none';
                }
            });

            if (lastSheetName && sheetNames.includes(lastSheetName)) {
                const prev = container.querySelector(`[data-sheet="${CSS.escape(lastSheetName)}"]`);
                if (prev) {
                    requestAnimationFrame(() => prev.click());
                    return;
                }
            }
            if (sheetNames.length === 1) {
                requestAnimationFrame(() => {
                    const chip = container.querySelector('mdui-chip');
                    if (chip) chip.click();
                });
            }
        }

        function showParsed(fileName) {
            currentFileName = fileName;
            dataLoaded = true;
            $('psDropZone').style.display = 'none';
            $('psDownloadSection').style.display = 'none';
            $('psBottomBar').style.display = 'flex';
            $('psFileName').textContent = fileName;
            $('psSearchBar').style.display = '';
            $('psResultsList').style.display = '';
            $('psCachedBadge').style.display = poolDownloaded ? '' : 'none';

            renderSheetChips();
            $('psResultsList').innerHTML = '<div style="padding:50px 20px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="table_chart" style="font-size:36px;opacity:0.3;display:block;margin:0 auto 6px;"></mdui-icon>请选择一个工作表开始搜索</div>';
        }

        function showDropZone() {
            const searchBar = $('psSearchBar');
            const si = $('psSearchInput');
            const scWrap = $('psSheetChipsWrap');
            const ss = $('psSearchStatus');
            const bb = $('psBottomBar');
            const dz = $('psDropZone');
            const rl = $('psResultsList');
            const ds = $('psDownloadSection');

            if (searchBar) searchBar.style.display = 'none';
            if (si) { si.disabled = true; si.value = ''; }
            if (scWrap) { scWrap.style.display = 'none'; $('psSheetChips').innerHTML = ''; }
            if (ss) ss.style.display = 'none';
            if (bb) bb.style.display = 'none';
            if (dz) dz.style.display = '';
            if (ds) ds.style.display = 'none';
            if (rl) {
                rl.style.display = '';
                rl.innerHTML = '<div style="padding:50px 20px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="upload_file" style="font-size:42px;opacity:0.35;display:block;margin:0 auto 8px;"></mdui-icon>请先上传 Excel 文件</div>';
            }
            currentItems = [];
            fuseInstance = null;
            allSheetData = {};
            sheetNames = [];
            dataLoaded = false;
            poolDownloaded = false;
        }

        function handleFile(file, handle) {
            if (handle) {
                savedHandle = handle;
                saveHandleToDB(handle);
            }
            poolDownloaded = false;

            $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>正在解析 Excel...</span></div>';

            ensureLibs().then(() => parseFile(file)).then(() => {
                showParsed(file.name);
            }).catch(err => {
                $('psResultsList').innerHTML = '<div style="padding:40px;text-align:center;color:rgb(var(--mdui-color-error));"><mdui-icon name="error_outline" style="font-size:36px;display:block;margin:0 auto 6px;"></mdui-icon>解析失败: ' + escapeHtml(err.message) + '</div>';
                addLog('Excel 解析失败: ' + err.message, 'error');
            });
        }

        async function pickFileViaFSA() {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Excel 文件',
                        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xls'] }
                    }],
                    startIn: 'documents'
                });
                const file = await handle.getFile();
                handleFile(file, handle);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    addLog('文件选择失败: ' + e.message, 'error');
                }
            }
        }

        function selectSheet(name) {
            currentSheet = name;
            lastSheetName = name;
            currentItems = allSheetData[name] || [];
            fuseInstance = null;
            $('psSearchInput').value = '';
            $('psSearchInput').disabled = false;
            $('psSearchInput').focus();
            $('psSearchStatus').style.display = 'flex';
            $('psTotalCount').textContent = String(currentItems.length);

            const headers = allSheetHeaders[name] || [];
            const keys = [];
            headers.forEach(h => {
                const hl = h.toLowerCase();
                if (/名称|品名|商品名称|goodsname/i.test(hl)) keys.push({ name: h, weight: 3 });
                else if (/型号|model|规格/i.test(hl)) keys.push({ name: h, weight: 2 });
                else if (/企业商品编号|编号|条码|code|编码/i.test(hl)) keys.push({ name: h, weight: 1 });
            });
            if (keys.length === 0) headers.forEach(h => keys.push({ name: h, weight: 1 }));

            fuseInstance = new Fuse(currentItems, {
                keys,
                threshold: 0.45,
                distance: 100,
                minMatchCharLength: 1,
                includeScore: true,
                includeMatches: true,
                findAllMatches: true,
                ignoreLocation: true
            });

            renderResults(currentItems.slice(0, 30));
            $('psMatchCount').textContent = String(currentItems.length);
        }

        function highlightText(text, query) {
            if (!text || !query) return escapeHtml(text || '');
            const tokens = query.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) return escapeHtml(text);
            const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            const re = new RegExp('(' + pattern + ')', 'gi');
            return escapeHtml(text).replace(re, '<mark class="ps-highlight">$1</mark>');
        }

        function matchPercent(query, codeField, nameField) {
            if (!query) return null;
            const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!q.length) return null;
            let best = 0;
            for (const field of [codeField, nameField]) {
                if (!field) continue;
                const t = field.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!t.length) continue;
                for (let s = 0; s < t.length; s++) {
                    let i = 0;
                    while (s + i < t.length && i < q.length && t[s + i] === q[i]) i++;
                    if (i > best) best = i;
                }
            }
            return Math.round((best / q.length) * 100) || null;
        }

        function renderResults(items) {
            const list = $('psResultsList');
            list.innerHTML = '';
            if (!items || !items.length) {
                list.innerHTML = '<div style="padding:40px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="search_off" style="font-size:32px;opacity:0.3;display:block;margin:0 auto 4px;"></mdui-icon>无匹配结果</div>';
                $('psMatchCount').textContent = '0';
                return;
            }
            $('psMatchCount').textContent = String(items.length);
            const maxShow = 30;
            const query = $('psSearchInput') ? $('psSearchInput').value : '';
            items.slice(0, maxShow).forEach(r => {
                const item = r.item || r;
                const codeField = findField(item, ['企业商品编号', '商品编号', '编号', 'goodsCode', '条码', '编码']);
                const nameField = findField(item, ['商品名称', '名称', 'goodsName', '品名']);
                const typeField = findField(item, ['商品类型']);
                const priceField = findField(item, ['备案价', '价格', 'filingPrice']);

                let scoreHtml = '';
                if (query) {
                    const pct = matchPercent(query, codeField, nameField);
                    if (pct != null) {
                        const cls = pct >= 80 ? 'ps-score-high' : pct >= 50 ? 'ps-score-mid' : 'ps-score-low';
                        scoreHtml = '<span class="ps-score-badge ' + cls + '">' + pct + '%</span>';
                    }
                }

                const nameHtml = query ? highlightText(nameField, query) : escapeHtml(nameField);
                const codeHtml = query ? highlightText(codeField, query) : escapeHtml(codeField);

                const row = document.createElement('div');
                row.className = 'ps-result-row';
                row.innerHTML =
                    '<div class="ps-result-left">' +
                        '<span class="ps-result-name">' + nameHtml + '</span>' +
                        '<span class="ps-result-meta">' +
                            '<span>' + codeHtml + '</span>' +
                            (typeField ? '<span>' + escapeHtml(typeField) + '</span>' : '') +
                        '</span>' +
                    '</div>' +
                    scoreHtml +
                    '<span class="ps-result-price">¥' + escapeHtml(priceField || '-') + '</span>';
                row.addEventListener('click', () => importProduct(item));
                list.appendChild(row);
            });
            if (items.length > maxShow) {
                const hint = document.createElement('div');
                hint.style.cssText = 'padding:8px;text-align:center;font-size:12px;color:rgb(var(--mdui-color-outline));';
                hint.textContent = '仅显示前 ' + maxShow + ' 条，请缩小搜索范围';
                list.appendChild(hint);
            }
        }

        // 品类关键词 → 主表单 chip value 映射表
        const CATEGORY_MAP = [
            { keys: ['电视', '电视机', '彩电'], val: 'A01' },
            { keys: ['冰箱', '冰柜', '冷柜'], val: 'A02' },
            { keys: ['洗衣机', '洗衣', '烘干'], val: 'A03' },
            { keys: ['空调', '空调挂机', '空调柜机', '中央空调'], val: 'A04' },
            { keys: ['电脑', '笔记本', '台式机', '一体机'], val: 'A05' },
            { keys: ['热水器', '燃气热水器', '电热水器', '热水'], val: 'A06' },
            { keys: ['手机', '智能手机'], val: 'B01' },
            { keys: ['平板', '平板电脑'], val: 'B02' },
            { keys: ['手表', '手环', '智能手表', '智能手环'], val: 'B03' },
            { keys: ['智能眼镜', '眼镜', 'AR眼镜', 'VR眼镜'], val: 'B04' },
            { keys: ['干衣机'], val: 'JS001' },
            { keys: ['洗碗机'], val: 'JS002' },
            { keys: ['烟机', '油烟机', '抽油烟机'], val: 'JS003' },
            { keys: ['燃气灶', '灶具', '灶'], val: 'JS004' },
            { keys: ['净水器', '净水', '饮水机'], val: 'JS005' },
            { keys: ['智能马桶', '马桶', '马桶盖'], val: 'JS006' },
            { keys: ['扫地机', '扫地机器人', '拖地机', '扫地'], val: 'JS007' },
            { keys: ['数码相机', '相机', '微单', '单反'], val: 'JS008' },
            { keys: ['电动轮椅', '轮椅'], val: 'JS010' },
        ];

        function selectCategoryChip(typeText) {
            if (!typeText) return;
            for (const entry of CATEGORY_MAP) {
                for (const kw of entry.keys) {
                    if (typeText.includes(kw)) {
                        const chip = document.querySelector('#productCategoryChips mdui-chip[value="' + entry.val + '"]');
                        if (chip) { chip.selected = true; }
                        addLog('品类匹配: ' + typeText + ' → ' + entry.val, 'info');
                        return;
                    }
                }
            }
        }

        function importProduct(item) {
            const codeEl = $('goodsCode');
            const goodsCode = findField(item, ['企业商品编号', '商品编号', '编号', 'goodsCode', '编码']);

            codeEl.value = goodsCode;
            $('productSearchDialog').open = false;

            setTimeout(() => queryGoodsInfo(), 100);
        }

        let searchTimer = null;
        function doSearch(q) {
            if (!q || !currentItems.length) {
                renderResults(currentItems.slice(0, 30).map(item => ({ item, score: null })));
                return;
            }

            const tokens = q.trim().split(/\s+/).filter(Boolean);
            if (!tokens.length) {
                renderResults(currentItems.slice(0, 30).map(item => ({ item, score: null })));
                return;
            }

            if (fuseInstance) {
                if (tokens.length === 1) {
                    renderResults(fuseInstance.search(tokens[0]));
                } else {
                    const resultsPerToken = tokens.map(t => fuseInstance.search(t));
                    const intersection = resultsPerToken[0].filter(r =>
                        resultsPerToken.slice(1).every(arr => arr.some(r2 => r2.item === r.item))
                    );
                    intersection.forEach(r => {
                        const bestScores = resultsPerToken
                            .map(arr => arr.find(r2 => r2.item === r.item))
                            .filter(Boolean)
                            .map(r2 => r2.score);
                        r.score = Math.min(...bestScores);
                    });
                    intersection.sort((a, b) => a.score - b.score);
                    renderResults(intersection);
                }
            } else {
                const matched = currentItems.filter(item =>
                    tokens.every(tok => {
                        const lt = tok.toLowerCase();
                        return Object.values(item).some(v => String(v || '').toLowerCase().includes(lt));
                    })
                ).map(item => ({ item, score: null }));
                renderResults(matched);
            }
        }

        async function open() {
            $('productSearchDialog').open = true;
            try { await ensureLibs(); } catch (e) { addLog('依赖库加载失败: ' + e.message, 'error'); }

            const poolUrl = (state.productPoolPath || '').trim();

            if (dataLoaded && sheetNames.length > 0) {
                showParsed(currentFileName);
                return;
            }

            if (poolUrl && /^https?:\/\//i.test(poolUrl)) {
                // 先显示加载状态，避免用户以为卡住了
                $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>正在加载商品池...</span></div>';
                $('psDropZone').style.display = 'none';
                $('psDownloadSection').style.display = 'none';
                $('psSearchBar').style.display = 'none';
                $('psSheetChipsWrap').style.display = 'none';
                $('psSearchStatus').style.display = 'none';
                $('psBottomBar').style.display = 'none';

                // 尝试从 IndexedDB 缓存读取
                const cachedBlob = await loadCachedPoolBlob(poolUrl);
                if (cachedBlob) {
                    const fileName = poolUrl.split('/').pop().split('?')[0] || 'products.xlsx';
                    addLog('使用缓存的商品池: ' + fileName, 'info');
                    await parseFile(new File([cachedBlob], fileName));
                    poolDownloaded = true;
                    showParsed(fileName);
                    return;
                }

                showDownloadUI();
                addLog('正在下载商品池: ' + poolUrl, 'info');
                try {
                    const arrayBuf = await downloadPoolWithProgress(poolUrl);
                    const fileName = poolUrl.split('/').pop().split('?')[0] || 'products.xlsx';
                    hideDownloadUI();
                    await parseFile(new File([arrayBuf], fileName));
                    poolDownloaded = true;
                    showParsed(fileName);
                    addLog('商品池下载并解析成功: ' + fileName, 'info');
                    // 后台缓存下载的文件，不阻塞 UI
                    savePoolBlobToCache(poolUrl, new Blob([arrayBuf]));
                    return;
                } catch (e) {
                    hideDownloadUI();
                    addLog('商品池下载失败: ' + e.message, 'error');
                    showSnackbar({ message: '商品池下载失败，可手动上传文件' });
                }
            }

            showDropZone();
            const recovered = await tryRecoverSavedFile();
            if (recovered) {
                handleFile(recovered, savedHandle);
            }
        }

        function showDownloadUI() {
            $('psDownloadSection').style.display = 'flex';
            $('psDropZone').style.display = 'none';
            $('psSearchBar').style.display = 'none';
            $('psSheetChipsWrap').style.display = 'none';
            $('psSearchStatus').style.display = 'none';
            $('psBottomBar').style.display = 'none';
            $('psResultsList').style.display = 'none';
            $('psResultsList').innerHTML = '';
            $('psDownloadProgress').value = 0;
            $('psDownloadStatus').textContent = '准备下载...';
        }

        function hideDownloadUI() {
            $('psDownloadSection').style.display = 'none';
        }

        async function downloadPoolWithProgress(url) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.timeout = 60000;

                xhr.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const pct = e.loaded / e.total;
                        $('psDownloadProgress').value = pct;
                        const loadedKB = (e.loaded / 1024).toFixed(0);
                        const totalKB = (e.total / 1024).toFixed(0);
                        $('psDownloadStatus').textContent = `下载中 ${loadedKB} / ${totalKB} KB (${Math.round(pct * 100)}%)`;
                    } else {
                        $('psDownloadStatus').textContent = `已下载 ${(e.loaded / 1024).toFixed(0)} KB...`;
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        $('psDownloadProgress').value = 1;
                        $('psDownloadStatus').textContent = '下载完成，正在解析...';
                        resolve(xhr.response);
                    } else {
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };

                xhr.onerror = () => reject(new Error('网络错误'));
                xhr.ontimeout = () => reject(new Error('请求超时'));
                xhr.send();
            });
        }

        function resetCache() {
            dataLoaded = false;
            poolDownloaded = false;
            sheetNames = [];
            allSheetData = {};
            allSheetHeaders = {};
            currentItems = [];
            fuseInstance = null;
            currentSheet = '';
            lastSheetName = '';
            currentFileName = '';
        }

        function init() {
            $('psCloseBtn').addEventListener('click', () => { $('productSearchDialog').open = false; });

            // 展开 drop zone 内选择 / 更换文件按钮
            $('psBrowseBtn').addEventListener('click', () => {
                if (window.showOpenFilePicker) {
                    pickFileViaFSA();
                } else {
                    $('psFileInput').click();
                }
            });

            $('psChangeFileBtn').addEventListener('click', () => {
                if (window.showOpenFilePicker) {
                    pickFileViaFSA();
                } else {
                    $('psFileInput').click();
                }
            });

            $('psFileInput').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleFile(file, null);
                $('psFileInput').value = '';
            });

            // 拖拽上传（drop zone）
            const dropZone = $('psDropZone');
            ['dragenter', 'dragover'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    e.preventDefault(); e.stopPropagation();
                    dropZone.classList.add('drag-over');
                });
            });
            ['dragleave', 'drop'].forEach(evt => {
                dropZone.addEventListener(evt, (e) => {
                    e.preventDefault(); e.stopPropagation();
                    dropZone.classList.remove('drag-over');
                });
            });
            dropZone.addEventListener('drop', async (e) => {
                const file = e.dataTransfer.files[0];
                if (!file) return;
                let handle = null;
                try {
                    const item = e.dataTransfer.items[0];
                    if (item && item.getAsFileSystemHandle) {
                        const h = await item.getAsFileSystemHandle();
                        if (h.kind === 'file') handle = h;
                    }
                } catch (_) {}
                handleFile(file, handle);
            });

            $('psSearchInput').addEventListener('input', () => {
                const val = $('psSearchInput').value.trim();
                $('psSearchClearBtn').style.display = val ? '' : 'none';
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => doSearch(val), 200);
            });

            $('psSearchClearBtn').addEventListener('click', () => {
                $('psSearchInput').value = '';
                $('psSearchClearBtn').style.display = 'none';
                doSearch('');
                $('psSearchInput').focus();
            });

            $('psChipExpandBtn').addEventListener('click', () => {
                const chips = $('psSheetChips');
                const btn = $('psChipExpandBtn');
                if (chips.classList.contains('collapsed')) {
                    chips.classList.remove('collapsed');
                    btn.textContent = '收起';
                } else {
                    chips.classList.add('collapsed');
                    btn.textContent = '展开工作表';
                }
            });
        }

        return { open, init, resetCache };
    })();

    function bindEventListeners() {
        document.getElementById('openProductSearchBtn')?.addEventListener('click', () => {
            ProductSearch.open();
        });

        document.getElementById('displayShopName').addEventListener('click', openShopMenu);
        document.getElementById('orderListBtn').addEventListener('click', openOrderDrawer);
        document.getElementById('configBtn').addEventListener('click', openConfigDialog);
        document.getElementById('refreshTokenBtn').addEventListener('click', () => {
            ProductSearch.resetCache();
            autoLogin();
        });
        document.getElementById('closeDrawerBtn').addEventListener('click', () => {
            document.getElementById('orderDrawer').open = false;
        });
        document.getElementById('refreshOrdersBtn').addEventListener('click', () => fetchOrders());
        document.getElementById('huanxinOrdersBtn').addEventListener('click', huanxinList);
        document.getElementById('searchOrdersBtn').addEventListener('click', () => fetchOrders());
        document.getElementById('orderSearchMobile').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fetchOrders();
        });

        document.getElementById('orderPayStateFilter').addEventListener('change', () => fetchOrders());
        document.getElementById('orderRecordStateFilter').addEventListener('change', () => fetchOrders());
        document.getElementById('orderTradeMonth').addEventListener('change', () => fetchOrders());
        document.getElementById('orderListContainer').addEventListener('scroll', handleOrderListScroll);

        document.getElementById('closeQrDialogBtn').addEventListener('click', () => {
            els.qrDialog.open = false;
        });
        document.getElementById('refreshQrBtn').addEventListener('click', refreshQrCode);
        els.qrImage.addEventListener('click', copyQrImage);

        document.getElementById('closeConfigDialogBtn').addEventListener('click', closeConfigDialog);
        document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
        document.getElementById('addPayloadBtn').addEventListener('click', addPayloadEntry);
        document.getElementById('exportConfigBtn').addEventListener('click', exportFullConfig);
        document.getElementById('importConfigBtn').addEventListener('click', importFullConfig);
        document.getElementById('cancelImportBtn').addEventListener('click', () => {
            document.getElementById('importConfigDialog').open = false;
        });
        document.getElementById('confirmImportBtn').addEventListener('click', confirmImportAction);
        document.getElementById('testDingTalkBtn').addEventListener('click', testDingTalk);
        document.getElementById('configPoolBrowseBtn').addEventListener('click', async () => {
            if (!window.showOpenFilePicker) {
                showSnackbar({ message: '当前浏览器不支持 File System Access，请手动输入云端 URL' });
                return;
            }
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: 'Excel 文件', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xls'] } }],
                    startIn: 'documents'
                });
                const file = await handle.getFile();
                document.getElementById('configProductPool').value = file.name;
                // 保存 handle 到 IndexedDB 供后续恢复
                const db = await new Promise((r, j) => { const req = indexedDB.open('ProductFileDB', 1); req.onupgradeneeded = () => req.result.createObjectStore('handles'); req.onsuccess = () => r(req.result); req.onerror = () => j(req.error); });
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(handle, 'lastExcel');
                await new Promise(r => { tx.oncomplete = r; });
                db.close();
                addLog('已关联本地文件: ' + file.name, 'info');
            } catch (e) {
                if (e.name !== 'AbortError') addLog('文件选择失败: ' + e.message, 'error');
            }
        });

        document.getElementById('configPoolDownloadBtn').addEventListener('click', async () => {
            const url = document.getElementById('configProductPool').value.trim();
            if (!url || !/^https?:\/\//i.test(url)) {
                return showSnackbar({ message: '请先输入有效的云端 URL 地址' });
            }

            const dialog = document.getElementById('poolDownloadDialog');
            const progress = document.getElementById('poolDlProgress');
            const status = document.getElementById('poolDlStatus');
            const closeBtn = document.getElementById('poolDlCloseBtn');

            progress.value = 0;
            status.textContent = '准备下载...';
            closeBtn.disabled = true;
            dialog.open = true;

            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.timeout = 60000;

            xhr.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = e.loaded / e.total;
                    progress.value = pct;
                    const loadedKB = (e.loaded / 1024).toFixed(0);
                    const totalKB = (e.total / 1024).toFixed(0);
                    status.textContent = `下载中 ${loadedKB} / ${totalKB} KB (${Math.round(pct * 100)}%)`;
                } else {
                    status.textContent = `已下载 ${(e.loaded / 1024).toFixed(0)} KB...`;
                }
            };

            xhr.onload = async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    progress.value = 1;
                    status.textContent = '下载成功，正在缓存...';
                    try {
                        await savePoolBlobToCache(url, new Blob([xhr.response]));
                        ProductSearch.resetCache();
                        status.textContent = '下载成功，已更新缓存';
                        addLog('手动下载商品池成功: ' + url, 'info');
                        showSnackbar({ message: '商品池下载并缓存成功' });
                    } catch (e) {
                        status.textContent = '缓存失败: ' + e.message;
                        addLog('商品池缓存失败: ' + e.message, 'warn');
                    }
                } else {
                    status.textContent = '下载失败: HTTP ' + xhr.status;
                    addLog('商品池下载失败: HTTP ' + xhr.status, 'error');
                }
                closeBtn.disabled = false;
            };

            xhr.onerror = () => {
                status.textContent = '下载失败: 网络错误';
                closeBtn.disabled = false;
                addLog('商品池下载网络错误', 'error');
            };

            xhr.ontimeout = () => {
                status.textContent = '下载失败: 请求超时';
                closeBtn.disabled = false;
                addLog('商品池下载超时', 'error');
            };

            xhr.send();
        });

        document.getElementById('poolDlCloseBtn').addEventListener('click', () => {
            document.getElementById('poolDownloadDialog').open = false;
        });

        document.getElementById('closeErrorDialogBtn').addEventListener('click', () => {
            els.errorDialog.open = false;
        });
        document.getElementById('closeChangelogDialogBtn').addEventListener('click', () => {
            document.getElementById('changelogDialog').open = false;
        });

        document.getElementById('closeConfirmDialogBtn').addEventListener('click', closeConfirmDialog);
        document.getElementById('confirmCancelBtn').addEventListener('click', cancelOrder);

        document.getElementById('closeRefundDialogBtn').addEventListener('click', closeRefundDialog);
        document.getElementById('confirmRefundBtn').addEventListener('click', refundOrder);

        document.getElementById('closePushDialogBtn').addEventListener('click', closePushDialog);
        document.getElementById('confirmPushBtn').addEventListener('click', confirmPush);
        document.getElementById('detailPushBtn').addEventListener('click', openDetailPushDialog);
        document.getElementById('detailContent').addEventListener('click', (e) => {
            if (e.target.closest('.fill-order-detail-btn')) {
                fillOrderToForm();
            }
        });

        document.getElementById('smartParseBtn').addEventListener('click', smartParse);
        document.getElementById('checkQualificationBtn').addEventListener('click', checkQualification);
        document.getElementById('remindQualificationBtn').addEventListener('click', startRemindPolling);
        document.getElementById('closeRemindSuccessDialogBtn').addEventListener('click', () => {
            document.getElementById('remindSuccessDialog').open = false;
        });
        document.getElementById('buyerMobile').addEventListener('input', function () {
            this.setCustomValidity('');
            stopRemindPolling();
            showRemindBtn(false);
        });
        document.getElementById('chipExpandBtn').addEventListener('click', toggleChipExpand);
        document.getElementById('autoOrderNumCheckbox').addEventListener('change', toggleOrderInput);
        document.getElementById('goodsCode').addEventListener('blur', queryGoodsInfo);
        document.getElementById('shopPrice').addEventListener('change', calcPrice);
        document.getElementById('actualPrice').addEventListener('change', reverseCalcPrice);
        document.getElementById('checkSncodeBtn').addEventListener('click', checkSncode);
        document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
        document.getElementById('versionTrigger').addEventListener('click', handleVersionClick);
        document.getElementById('openLsEditorBtn').addEventListener('click', openLsEditor);
        document.getElementById('clearDebugLogsBtn').addEventListener('click', clearDebugLogs);
        document.getElementById('closeLogPanelBtn').addEventListener('click', () => toggleLogPanel(false));
        document.getElementById('closeLsEditorBtn').addEventListener('click', () => {
            document.getElementById('lsEditorDialog').open = false;
        });
        document.getElementById('refreshLsEditorBtn').addEventListener('click', refreshLsEditor);
        document.getElementById('addNewLsItemBtn').addEventListener('click', addNewLsItem);
        document.getElementById('clearAllLsBtn').addEventListener('click', clearAllLs);

        els.payloadList.addEventListener('click', (e) => {
            const validateBtn = e.target.closest('.validate-payload-btn');
            if (validateBtn) {
                const index = parseInt(validateBtn.dataset.index, 10);
                validatePayloadEntry(index);
            }

            const removeBtn = e.target.closest('.remove-payload-btn');
            if (removeBtn && !removeBtn.disabled) {
                const index = parseInt(removeBtn.dataset.index, 10);
                removePayloadEntry(index);
            }

            const radio = e.target.closest('mdui-radio');
            if (radio && radio.value !== undefined) {
                const index = parseInt(radio.value, 10);
                setCurrentStoreIndex(index, true);
            }
        });

        els.shopSwitchMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.shop-switch-item');
            if (item && item.dataset.index !== undefined) {
                const index = parseInt(item.dataset.index, 10);
                switchStore(index);
            }
        });

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!els.shopSwitchMenu.contains(target) && !els.shopName.contains(target)) {
                els.shopSwitchMenu.classList.remove('open');
            }
        });

        document.querySelector('#goodsName').addEventListener('change', (e) => {
            const code = e.target.value;
            if (!code) return;
            const codeInput = document.querySelector('#goodsCode');
            if (codeInput.value !== code) {
                codeInput.value = code;
                queryGoodsInfo();
            }
        });

        els.city.addEventListener('change', () => {
            const city = els.city.value;
            populateSelect(els.district, city ? Object.keys(state.regionTree[city] || {}) : []);
            populateSelect(els.town, []);
        });

        els.district.addEventListener('change', () => {
            const city = els.city.value;
            const district = els.district.value;
            const towns = (city && district) ? (state.regionTree[city][district] || []) : [];
            populateSelect(els.town, towns);
        });

        document.getElementById('orderListContainer').addEventListener('click', (e) => {
            const orderCard = e.target.closest('.order-card');
            const openQrBtn = e.target.closest('.open-qr-btn');
            const viewDetailBtn = e.target.closest('.view-order-detail-btn');

            if (openQrBtn) {
                e.stopPropagation();
                const orderNumber = openQrBtn.dataset.orderNumber;
                openQrDialog(orderNumber);
            } else if (viewDetailBtn) {
                e.stopPropagation();
                const orderNumber = viewDetailBtn.dataset.orderNumber;
                viewOrderDetail(orderNumber);
            } else if (orderCard) {
                const orderNumber = orderCard.dataset.orderNumber;
                viewOrderDetail(orderNumber);
            }
        });

        document.getElementById('lsItemList').addEventListener('click', (e) => {
            const btn = e.target.closest('mdui-button[data-action]');
            if (!btn) return;

            const action = btn.dataset.action;
            const key = btn.dataset.key;
            if (!key) return;

            if (action === 'save') {
                const container = btn.closest('div[style*="flex-direction: column"]');
                const input = container?.querySelector('mdui-text-field');
                if (input) {
                    try {
                        localStorage.setItem(key, input.value);
                        showSnackbar({ message: `已保存修改 [${key}]` });
                        addLog(`更新 Storage Key: ${key}`, "info");
                    } catch (err) {
                        mdui.alert({ headline: "保存失败", description: err.message, confirmText: "确定" });
                    }
                }
            } else if (action === 'delete') {
                mdui.confirm({
                    headline: "删除确认",
                    description: `确定删除数据项 [${key}] 吗？`,
                    confirmText: "确定删除",
                    cancelText: "取消",
                    onConfirm: () => {
                        localStorage.removeItem(key);
                        refreshLsEditor();
                        addLog(`删除 Storage Key: ${key}`, "warn");
                    }
                });
            }
        });

        document.getElementById('draftListBtn')?.addEventListener('click', openDraftDrawer);
        document.getElementById('closeDraftDrawerBtn')?.addEventListener('click', () => {
            document.getElementById('draftDrawer').open = false;
        });
        document.getElementById('draftListContainer')?.addEventListener('click', (e) => {
            const loadBtn = e.target.closest('.draft-load-btn');
            const delBtn = e.target.closest('.draft-del-btn');
            if (loadBtn) {
                handleDraftLoad(loadBtn.dataset.draftId);
            } else if (delBtn) {
                handleDraftDelete(delBtn.dataset.draftId);
            }
        });
        document.getElementById('draftDrawerClearAll')?.addEventListener('click', () => {
            mdui.confirm({
                headline: "清空暂存",
                description: "确定清空当前门店所有暂存订单吗？此操作不可撤销。",
                confirmText: "确定清空",
                cancelText: "取消",
                onConfirm: () => {
                    clearCurrentStoreDrafts();
                    renderDraftDrawerList();
                    renderDraftBar();
                    updateDraftBadge();
                    showSnackbar({ message: "已清空所有暂存" });
                }
            });
        });
    }

    function init() {
        initElements();
        initializeStorePayloads();
        loadOrderQueue();
        cleanupOrderQueue();
        loadOrderPushSentMap();
        cleanupOrderPushSentMap();
        loadDrafts();
        cleanupExpiredDrafts();
        bindLifecycleRecoveryEvents();
        autoUpdateVersion();
        scheduleNextVersionPoll();
        loadRecentGoods();

        state.dingTalkWebhook = localStorage.getItem(CONSTANTS.DINGTALK_WEBHOOK_KEY) || "";
        state.dingTalkSecret = localStorage.getItem(CONSTANTS.DINGTALK_SECRET_KEY) || "";

        state.aiEnable = localStorage.getItem(CONSTANTS.AI_ENABLE_KEY) === "true";
        state.aiEndpoint = localStorage.getItem(CONSTANTS.AI_ENDPOINT_KEY) || "";
        state.aiModel = localStorage.getItem(CONSTANTS.AI_MODEL_KEY) || "";
        state.aiKey = localStorage.getItem(CONSTANTS.AI_KEY_KEY) || "";
        state.productPoolPath = localStorage.getItem(CONSTANTS.PRODUCT_POOL_KEY) || "";

        if (state.storePayloads.length && state.storePayloads[state.currentStoreIndex]?.payload?.trim()) {
            state.loginPayload = state.storePayloads[state.currentStoreIndex].payload.trim();
            autoLogin();
        } else {
            openConfigDialog();
            showSnackbar({ message: "请先配置至少一个门店 Payload" });
        }

        renderShopSwitchMenu();
        bindEventListeners();
        ProductSearch.init();
        renderDraftBar();
        updateDraftBadge();
        updateQueueBadge();

        if (hasQueuedOrders()) {
            addLog(`启动自动检查，待检订单数: ${getAllQueuedOrders().length}`, "info");
            checkNowAndEnsurePolling("boot");
        }
    }

    window.addEventListener('load', init);
})();
