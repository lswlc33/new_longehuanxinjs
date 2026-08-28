(function () {
    'use strict';

    const CONSTANTS = {
        LONGE_API_BASE: "https://www.longehuanxinjs.com/ccb_equity_api_new",
        WORKER_API_BASE: "https://longe.xn--fiqz59cpva341l.top",
        CONFIG_KEY: "APP_LOGIN_PAYLOAD",
        STORE_PAYLOADS_KEY: "APP_LOGIN_PAYLOADS",
        CURRENT_STORE_INDEX_KEY: "APP_CURRENT_STORE_INDEX",
        STORE_CONFIG_VERSION: 2,
        RECENT_GOODS_KEY: "APP_RECENT_GOODS_V1",
        DEFAULT_PAYLOAD: "",
        DINGTALK_WEBHOOK_KEY: "DINGTALK_WEBHOOK",
        DINGTALK_SECRET_KEY: "DINGTALK_SECRET",
        AI_ENABLE_KEY: "AI_PARSE_ENABLE",
        AI_ENDPOINT_KEY: "AI_PARSE_ENDPOINT",
        AI_MODEL_KEY: "AI_PARSE_MODEL",
        AI_KEY_KEY: "AI_PARSE_KEY",
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
        DRAFTS_TTL_MS: 7 * 24 * 60 * 60 * 1000,
        PASS_GOODS_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
        PASS_GOODS_COUNT_KEY: "PASS_GOODS_LAST_COUNT"
        ,ORDER_QUERY_MAX_PAGES: 200
        ,ORDER_REQUEST_TIMEOUT_MS: 20000
        ,REMIND_POLL_INTERVAL_MS: 3000
        ,REMIND_POLL_MAX_ATTEMPTS: 200
        ,ORDER_NOTIFY_MAX_RETRIES: 10
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
        g_refunded: [5, 8, 10, 12]
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
        currentToken: "",
        orderToCancel: null,
        orderToRefund: null,
        orderToPush: null,
        currentQrOrderContext: null,
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
        remindPollAttempts: 0,
        remindPollInFlight: false,
        draftsData: { version: 1, drafts: {} },
        currentDraftId: null,
        isLoadingDraft: false,
        _queuedOrdersCache: null,
        _queuedOrdersCacheDirty: true,
        orderCurrentPage: 1,
        orderHasMore: false,
        orderLoadingMore: false,
        orderSearchResults: [],
        orderSubStates: null,
        orderStorePaging: {},
        orderQueryGeneration: 0,
        orderQuerySignature: "",
        orderQueryFailures: [],
        orderContextByKey: new Map(),
        _isRefreshingToken: false,
        currentUniscid: "",
        currentGoodsUniscid: "",
        storeRuntimeByKey: {},
        storeConfigRevision: 0,
        currentUiGeneration: 0,
        detailRequestGeneration: 0,
        qrRequestGeneration: 0,
        isSubmittingOrder: false,
        isManualPushInProgress: false,
        configDraft: null,
        configDraftCurrentIndex: 0
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
        return getStoreKey(state.storePayloads[state.currentStoreIndex], state.currentStoreIndex);
    }

    function parseStoreIndexFromKey(storeKey = "") {
        const match = String(storeKey).match(/^store_(\d+)$/);
        return match ? parseInt(match[1], 10) : -1;
    }

    function createStoreKey() {
        const suffix = typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
            : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        return `store_${suffix}`;
    }

    function getStoreKey(store, index = -1) {
        return store?.storeKey || (index >= 0 ? `store_${index}` : "");
    }

    function getStoreByKey(storeKey) {
        const index = state.storePayloads.findIndex((store, idx) => getStoreKey(store, idx) === storeKey);
        return index >= 0 ? state.storePayloads[index] : null;
    }

    function getStoreIndexByKey(storeKey) {
        return state.storePayloads.findIndex((store, idx) => getStoreKey(store, idx) === storeKey);
    }

    function resolvePersistedStoreKey(storeKey) {
        if (getStoreByKey(storeKey)) return storeKey;
        const legacyIndex = parseStoreIndexFromKey(storeKey);
        const legacyKey = legacyIndex >= 0 ? `legacy_store_${legacyIndex}` : "";
        return legacyKey && getStoreByKey(legacyKey) ? legacyKey : storeKey;
    }

    function getStoreContext(storeKey, fallback = {}) {
        const index = getStoreIndexByKey(storeKey);
        const store = index >= 0 ? state.storePayloads[index] : null;
        return {
            storeKey: storeKey || fallback.storeKey || "",
            storeIndex: index >= 0 ? index : (fallback.storeIndex ?? -1),
            storeName: store?.shopName || store?.name || fallback.storeName || (index >= 0 ? `门店${index + 1}` : "门店配置缺失")
        };
    }

    function getOrderContextKey(storeKey, orderNumber) {
        return `${storeKey || "unknown"}|${orderNumber || ""}`;
    }

    function attachOrderContext(order, storeKey, fallback = {}) {
        const context = getStoreContext(storeKey, fallback);
        const result = {
            ...order,
            storeKey: context.storeKey,
            storeIndex: context.storeIndex,
            storeName: context.storeName,
            storeOrderNumber: order?.shopOrderNumber || fallback.storeOrderNumber || ""
        };
        if (result.ccbPayOrderNumber) {
            state.orderContextByKey.set(getOrderContextKey(result.storeKey, result.ccbPayOrderNumber), result);
        }
        return result;
    }

    function findOrderContext(storeKey, orderNumber) {
        return state.orderContextByKey.get(getOrderContextKey(storeKey, orderNumber)) || null;
    }

    function ensureStoreRuntime(storeKey) {
        if (!state.storeRuntimeByKey[storeKey]) {
            state.storeRuntimeByKey[storeKey] = {
                token: "",
                tokenStatus: "unknown",
                tokenExpiresAt: 0,
                refreshPromise: null,
                uniscid: "",
                goodsUniscid: "",
                regionTree: {},
                lastError: ""
            };
        }
        return state.storeRuntimeByKey[storeKey];
    }

    function getStoreDisplayName(store, index) {
        return store.shopName || store.name || `门店${index + 1}`;
    }

    function loadOrderQueue() {
        const raw = localStorage.getItem(CONSTANTS.ORDER_QUEUE_KEY);
        const parsed = raw ? safeParseJSON(raw, null) : null;
        if (parsed && parsed.stores && typeof parsed.stores === "object") {
            const stores = {};
            Object.entries(parsed.stores).forEach(([storedStoreKey, bucket]) => {
                const storeKey = resolvePersistedStoreKey(storedStoreKey);
                const normalizedOrders = Object.fromEntries(Object.entries(bucket?.orders || {}).map(([orderNumber, item]) => ([
                    orderNumber,
                    {
                        ...item,
                        storeKey,
                        storeNameSnapshot: item?.storeNameSnapshot || bucket?.storeNameSnapshot || getStoreContext(storeKey).storeName,
                        storeIndex: item?.storeIndex ?? bucket?.storeIndex ?? getStoreIndexByKey(storeKey),
                        version: 2,
                        createdAt: Number(item?.createdAt) || Number(item?.lastCheckAt) || Date.now(),
                        retryCount: Number(item?.retryCount || 0),
                        lastError: item?.lastError || "",
                        lastPushAt: item?.lastPushAt || 0,
                        pendingNotification: item?.pendingNotification || "",
                        queryRetryCount: Number(item?.queryRetryCount ?? item?.retryCount ?? 0),
                        queryLastError: item?.queryLastError ?? item?.lastError ?? "",
                        queryLastCheckAt: item?.queryLastCheckAt ?? item?.lastCheckAt ?? 0,
                        notificationRetryCount: Number(item?.notificationRetryCount || 0),
                        notificationLastError: item?.notificationLastError || "",
                        notificationLastAttemptAt: item?.notificationLastAttemptAt ?? item?.lastPushAt ?? 0
                    }
                ])));
                // 两个旧键映射到同一个 storeKey 时合并订单，否则会丢掉待推送的已付款订单
                if (!stores[storeKey]) {
                    stores[storeKey] = {
                        storeNameSnapshot: bucket?.storeNameSnapshot || getStoreContext(storeKey).storeName,
                        storeIndex: bucket?.storeIndex ?? getStoreIndexByKey(storeKey),
                        orders: normalizedOrders
                    };
                } else {
                    Object.assign(stores[storeKey].orders, normalizedOrders);
                }
            });
            state.orderQueueByStore = {
                version: 2,
                updatedAt: parsed.updatedAt || Date.now(),
                stores
            };
        } else {
            state.orderQueueByStore = { version: 2, updatedAt: Date.now(), stores: {} };
        }
        saveOrderQueue();
    }

    function saveOrderQueue() {
        state.orderQueueByStore.updatedAt = Date.now();
        localStorage.setItem(CONSTANTS.ORDER_QUEUE_KEY, JSON.stringify(state.orderQueueByStore));
    }

    function loadOrderPushSentMap() {
        const raw = localStorage.getItem(CONSTANTS.ORDER_PUSH_SENT_KEY);
        const parsed = raw ? safeParseJSON(raw, {}) : {};
        const merged = {};
        Object.entries(parsed || {}).forEach(([key, value]) => {
            const parts = key.split('|');
            if (parts.length >= 3) parts[0] = resolvePersistedStoreKey(parts[0]);
            const normalizedKey = parts.join('|');
            // 键冲突时保留较新的推送时间，避免把“已推送”标记覆盖成更早的时间
            merged[normalizedKey] = Math.max(Number(merged[normalizedKey] || 0), Number(value) || 0);
        });
        state.orderPushSentMap = merged;
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
        let removed = 0;

        Object.keys(stores).forEach(storeKey => {
            const bucket = stores[storeKey];
            const orders = bucket?.orders || {};

            Object.keys(orders).forEach(orderNumber => {
                const item = orders[orderNumber] || {};
                // 按创建时间计龄：lastCheckAt 每轮轮询都会刷新，用它算龄会导致 TTL 永不生效
                const createdAt = Number(item.createdAt) || 0;

                if (!createdAt || now - createdAt > CONSTANTS.ORDER_QUEUE_TTL_MS) {
                    addLog(`订单[${orderNumber}]超过 ${Math.round(CONSTANTS.ORDER_QUEUE_TTL_MS / 3600000)} 小时仍未终态，移出轮询队列`, "warn");
                    delete orders[orderNumber];
                    removed += 1;
                }
            });

            if (Object.keys(orders).length === 0) {
                delete stores[storeKey];
            }
        });

        saveOrderQueue();
        invalidateQueuedOrdersCache();
        if (removed) updateQueueBadge();
        return removed;
    }

    function ensureStoreQueueBucket(storeKey) {
        if (!state.orderQueueByStore.stores[storeKey]) {
            const context = getStoreContext(storeKey);
            state.orderQueueByStore.stores[storeKey] = {
                storeNameSnapshot: context.storeName,
                storeIndex: context.storeIndex,
                orders: {}
            };
        } else if (!state.orderQueueByStore.stores[storeKey].orders) {
            state.orderQueueByStore.stores[storeKey].orders = {};
        }
        return state.orderQueueByStore.stores[storeKey];
    }

    function enqueueOrder(storeKey, orderNumber, meta = {}) {
        addLog(`订单[${orderNumber}]入队轮询，所属门店[${storeKey}]`, "info");
        const bucket = ensureStoreQueueBucket(storeKey);
        const context = getStoreContext(storeKey, meta);
        // 已在队列里的订单只做字段合并，避免退款入队把 buyerMobile / 轮询进度冲掉
        const existing = bucket.orders[orderNumber] || {};
        const pick = (key, fallback) => (meta[key] !== undefined ? meta[key] : (existing[key] !== undefined ? existing[key] : fallback));
        bucket.orders[orderNumber] = {
            version: 2,
            storeKey,
            storeNameSnapshot: pick('storeNameSnapshot', context.storeName),
            storeIndex: pick('storeIndex', context.storeIndex),
            lastState: Number(pick('lastState', 0)),
            buyerMobile: pick('buyerMobile', ""),
            createdAt: existing.createdAt || meta.createdAt || Date.now(),
            lastCheckAt: pick('lastCheckAt', 0),
            retryCount: Number(pick('retryCount', 0)),
            lastError: pick('lastError', ""),
            lastPushAt: pick('lastPushAt', 0),
            pendingNotification: pick('pendingNotification', ""),
            queryRetryCount: Number(meta.queryRetryCount ?? meta.retryCount ?? existing.queryRetryCount ?? 0),
            queryLastError: meta.queryLastError ?? meta.lastError ?? existing.queryLastError ?? "",
            queryLastCheckAt: meta.queryLastCheckAt ?? meta.lastCheckAt ?? existing.queryLastCheckAt ?? 0,
            notificationRetryCount: Number(pick('notificationRetryCount', 0)),
            notificationLastError: pick('notificationLastError', ""),
            notificationLastAttemptAt: meta.notificationLastAttemptAt ?? meta.lastPushAt ?? existing.notificationLastAttemptAt ?? 0
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

    function findOrderInQueue(orderNumber, preferredStoreKey = "") {
        if (preferredStoreKey) {
            const preferred = state.orderQueueByStore.stores?.[preferredStoreKey]?.orders?.[orderNumber];
            if (preferred) return { storeKey: preferredStoreKey, item: preferred };
        }
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
            // 旧键与新键可能同时存在并解析到同一个 storeKey，必须合并而不是后者覆盖前者
            const merged = {};
            Object.entries(parsed.drafts).forEach(([storedKey, drafts]) => {
                const storeKey = resolvePersistedStoreKey(storedKey);
                const list = Array.isArray(drafts) ? drafts : [];
                if (!merged[storeKey]) {
                    merged[storeKey] = [...list];
                    return;
                }
                const seen = new Set(merged[storeKey].map(d => d?.id));
                list.forEach(d => {
                    if (!d?.id || seen.has(d.id)) return;
                    seen.add(d.id);
                    merged[storeKey].push(d);
                });
            });
            Object.values(merged).forEach(list => list.sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0)));
            state.draftsData = { version: 2, drafts: merged };
        } else {
            state.draftsData = { version: 1, drafts: {} };
        }
    }

    function saveDraftsToStorage() {
        try {
            localStorage.setItem(CONSTANTS.DRAFTS_KEY, JSON.stringify(state.draftsData));
        } catch (e) {
            addLog(`暂存写入失败: ${e.message}`, "error");
            showSnackbar({ message: "暂存保存失败，本地存储可能已满", closeable: true });
        }
    }

    function getCurrentStoreDrafts() {
        const storeKey = getCurrentStoreKey();
        return state.draftsData.drafts[storeKey] || [];
    }

    function setCurrentStoreDrafts(list) {
        state.draftsData.drafts[getCurrentStoreKey()] = list;
    }

    /** 资格是多选的，全部记下来；category 保留单值以兼容旧数据 */
    function getSelectedCategoryValues() {
        return Array.from(document.querySelectorAll('#productCategoryChips mdui-chip'))
            .filter(c => c.selected)
            .map(c => c.value);
    }

    function getSelectedCategoryValue() {
        return getSelectedCategoryValues()[0] || "";
    }

    function setSelectedCategories(values) {
        const list = Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : []);
        document.querySelectorAll('#productCategoryChips mdui-chip').forEach(c => {
            c.selected = list.includes(c.value);
        });
        sortSelectedChipsToTop();
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
            categories: getSelectedCategoryValues(),
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
        if (idx === -1) return false;
        list.splice(idx, 1);
        if (list.length) {
            state.draftsData.drafts[storeKey] = list;
        } else {
            delete state.draftsData.drafts[storeKey];
        }
        saveDraftsToStorage();
        if (state.currentDraftId === draftId) {
            state.currentDraftId = null;
        }
        addLog(`删除暂存`, "info");
        return true;
    }

    function clearCurrentStoreDrafts() {
        delete state.draftsData.drafts[getCurrentStoreKey()];
        saveDraftsToStorage();
        state.currentDraftId = null;
        addLog("已清空当前门店所有暂存", "info");
    }

    /**
     * 恢复暂存到表单。整个过程约 1.5 秒，中途门店可能被切换，
     * 因此每个 await 之后都要确认门店与 UI 世代没变，否则把数据写进别的门店。
     */
    async function loadDraftToForm(draftId) {
        const storeKey = getCurrentStoreKey();
        const uiGeneration = state.currentUiGeneration;
        const list = state.draftsData.drafts[storeKey] || [];
        const draft = list.find(d => d.id === draftId);
        if (!draft) {
            showSnackbar({ message: "暂存不存在或不属于当前门店" });
            return false;
        }
        const fd = draft.formData || {};
        const alive = () => uiGeneration === state.currentUiGeneration && storeKey === getCurrentStoreKey();
        const wait = async (ms) => {
            await new Promise(r => setTimeout(r, ms));
            return alive();
        };

        document.querySelector('#buyerMobile').value = fd.buyerMobile || '';
        document.querySelector('#buyerName').value = fd.buyerName || '';
        if (!await wait(200)) return false;

        setSelectedCategories(fd.categories || fd.category);
        if (!await wait(150)) return false;

        let addressRestored = true;
        if (fd.city) {
            if (!state.regionTree[fd.city]) {
                // 地址库还没加载完，这里静默跳过会让操作员在提交时才发现地址是空的
                addressRestored = false;
            } else {
                els.city.value = fd.city;
                if (!await wait(150)) return false;
                populateSelect(els.district, Object.keys(state.regionTree[fd.city]), fd.district);
                if (!await wait(200)) return false;
                const towns = state.regionTree[fd.city]?.[fd.district] || [];
                populateSelect(els.town, towns, fd.townCode);
                if (!await wait(150)) return false;
            }
        }

        document.querySelector('#detailAddress').value = fd.detailAddress || '';
        if (!await wait(150)) return false;

        document.querySelector('#goodsCode').value = fd.goodsCode || '';
        document.querySelector('#goodsCode').dataset.goodsName = fd.goodsName || '';
        if (fd.goodsCode && fd.goodsName) {
            saveRecentGoods(fd.goodsCode, fd.goodsName);
        }
        if (!await wait(200)) return false;

        document.querySelector('#filingPrice').value = fd.filingPrice || '';
        document.querySelector('#shopPrice').value = fd.shopPrice || '';
        document.querySelector('#actualPrice').value = fd.actualPrice || '';
        document.querySelector('#subsidyPrice').value = fd.subsidyPrice || '';
        if (!await wait(100)) return false;

        document.querySelector('#autoOrderNumCheckbox').checked = fd.autoOrderNum !== false;
        toggleOrderInput(fd.shopOrderNumber);

        validateShopPriceAgainstFiling();
        state.currentDraftId = draftId;
        updateDraftBadge();
        schedulePreviewRender();
        addLog(`已加载暂存: ${draft.label}`, "info");
        if (!addressRestored) {
            showSnackbar({ message: "地址库未就绪，地址未恢复，请稍后重新加载该暂存", closeable: true });
            addLog(`暂存[${draft.label}]的地址未恢复：地址库尚未加载`, "warn");
        }
        return true;
    }

    function cleanupExpiredDrafts() {
        const now = Date.now();
        let cleaned = 0;
        for (const storeKey in state.draftsData.drafts) {
            const list = state.draftsData.drafts[storeKey] || [];
            const filtered = list.filter(d => {
                // 缺少/非法时间戳的暂存不能当成过期直接删掉
                const stamp = Number(d?.updatedAt) || Number(d?.createdAt) || 0;
                const valid = !stamp || (now - stamp) < CONSTANTS.DRAFTS_TTL_MS;
                if (!valid) cleaned++;
                return valid;
            });
            state.draftsData.drafts[storeKey] = filtered;
            if (filtered.length === 0) delete state.draftsData.drafts[storeKey];
        }
        if (cleaned > 0) {
            addLog(`已清理 ${cleaned} 条过期暂存`, "info");
        }
        saveDraftsToStorage();
    }

    function saveCurrentAsDraft() {
        if (!isFormHasContent()) {
            return showSnackbar({ message: "表单为空，请先填写内容" });
        }
        // 已经加载了某条暂存时就地更新，否则每次点“暂存”都会多出一张几乎一样的卡
        if (state.currentDraftId && updateDraft(state.currentDraftId)) {
            addLog(`更新暂存: ${state.currentDraftId}`, "info");
            showSnackbar({ message: "已更新当前暂存" });
        } else {
            const draft = createDraft();
            showSnackbar({ message: `已暂存: ${draft.label}` });
        }
        updateDraftBadge();
        renderDraftDrawerList();
    }

    function updateDraftBadge() {
        const badge = document.getElementById('draftBadge');
        if (!badge) return;
        const count = getCurrentStoreDrafts().length;
        if (count > 0) {
            badge.style.display = '';
            setTextAnimated(badge, count > 9 ? '9+' : String(count), 'value-pop');
        } else {
            badge.style.display = 'none';
        }
    }

    function updateQueueBadge() {
        const badge = document.getElementById('orderQueueBadge');
        if (!badge) return;
        const count = getAllQueuedOrders().length;
        if (count > 0) {
            badge.style.display = '';
            setTextAnimated(badge, count > 9 ? '9+' : String(count), 'value-pop');
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
        // 连点两张卡会把两份数据交叉写进同一个表单，这里做互斥
        if (state.isLoadingDraft) return showSnackbar({ message: "正在加载暂存，请稍候" });
        state.isLoadingDraft = true;
        const loadBtn = document.querySelector(`.draft-load-btn[data-draft-id="${draftId}"]`);
        if (loadBtn) loadBtn.loading = true;
        // 先关抽屉再恢复，避免恢复过程中还能继续点其它卡片
        const drawer = document.getElementById('draftDrawer');
        if (drawer) drawer.open = false;
        try {
            const ok = await loadDraftToForm(draftId);
            if (ok) showSnackbar({ message: "已加载暂存订单" });
        } finally {
            if (loadBtn) loadBtn.loading = false;
            state.isLoadingDraft = false;
        }
    }

    function handleDraftDelete(draftId) {
        const removed = deleteDraft(draftId);
        renderDraftDrawerList();
        updateDraftBadge();
        showSnackbar({ message: removed ? "已删除暂存" : "该暂存不存在或不属于当前门店" });
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

    const _TOKEN_ERROR_KEYWORDS = ['token', '登录', '过期', '无效', '失效', '未登录'];

    function _isTokenError(res) {
        if (!res || res.code === 0) return false;
        if (res.code === 401) return true;
        const msg = (res.msg || '').toLowerCase();
        return _TOKEN_ERROR_KEYWORDS.some(kw => msg.includes(kw));
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = CONSTANTS.ORDER_REQUEST_TIMEOUT_MS) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const response = await fetch(url, controller ? { ...options, signal: controller.signal } : options);
            return await response.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function refreshTokenForStore(storeKey) {
        const runtime = ensureStoreRuntime(storeKey);
        if (runtime.refreshPromise) return runtime.refreshPromise;

        const store = getStoreByKey(storeKey);
        if (!store?.payload?.trim()) {
            runtime.tokenStatus = "missing";
            runtime.lastError = "未配置 Payload";
            return "";
        }

        runtime.refreshPromise = (async () => {
            addLog(`门店[${getStoreContext(storeKey).storeName}] Token 刷新中`, "warn");
            const tokenRes = await requestTokenByPayload(store.payload.trim());
            if (tokenRes?.code === 0 && tokenRes.data) {
                runtime.token = tokenRes.data;
                runtime.tokenStatus = "valid";
                runtime.lastError = "";
                if (storeKey === getCurrentStoreKey()) state.currentToken = tokenRes.data;
                addLog(`门店[${getStoreContext(storeKey).storeName}] Token 刷新成功`, "info");
                return runtime.token;
            }
            runtime.token = "";
            runtime.tokenStatus = "invalid";
            runtime.lastError = tokenRes?.msg || "Token 获取失败";
            addLog(`门店[${getStoreContext(storeKey).storeName}] Token 刷新失败`, "error");
            return "";
        })().finally(() => {
            runtime.refreshPromise = null;
        });

        return runtime.refreshPromise;
    }

    async function _refreshTokenAndRetry(storeKey, endpoint, method, data) {
        const token = await refreshTokenForStore(storeKey);
        if (!token) {
            if (storeKey === getCurrentStoreKey()) {
                showError(`登录已失效，请重新配置`);
            }
            return null;
        }
        addLog(`使用门店[${getStoreContext(storeKey).storeName}]新Token重试请求 [${endpoint}]`, "info");
        return callApiWithToken(token, endpoint, method, data, storeKey, false);
    }

    async function callApiWithToken(token, endpoint, method = 'GET', data = null, storeKey = getCurrentStoreKey(), retryOnTokenError = true) {
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
            const result = await fetchWithTimeout(url, options);
            if (result.code !== 0) {
                addLog(`接口响应异常[${endpoint}]: ${result.msg}`, "warn");
                if (retryOnTokenError && _isTokenError(result)) {
                    const retryResult = await _refreshTokenAndRetry(storeKey, endpoint, method, data);
                    if (retryResult !== null) return retryResult;
                }
            }
            return result;
        } catch (error) {
            addLog(`网络请求失败[${endpoint}]: ${error.message}`, "error");
            return null;
        }
    }

    async function getTokenForStoreKey(storeKey) {
        const runtime = ensureStoreRuntime(storeKey);
        if (runtime.token) return runtime.token;
        return refreshTokenForStore(storeKey);
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

    function buildFullConfigBackup() {
        // 导出按钮位于配置弹窗内，弹窗未保存时应以界面上的最新填写为准，避免备份漏掉刚录入的值
        const useDraft = !!(els.configDialog && els.configDialog.open && Array.isArray(state.configDraft));
        if (useDraft) syncPayloadsFromInputs();

        const sourceStores = useDraft ? state.configDraft : state.storePayloads;
        const sourceIndex = useDraft ? state.configDraftCurrentIndex : state.currentStoreIndex;
        const readLive = (id, savedValue) => {
            if (!useDraft) return savedValue;
            const el = document.getElementById(id);
            return el ? (el.value || "").trim() : savedValue;
        };

        const stores = (Array.isArray(sourceStores) ? sourceStores : []).map((store, index) => ({
            storeKey: getStoreKey(store, index),
            name: store.shopName || store.name || `门店${index + 1}`,
            shopName: store.shopName || "",
            verified: !!store.verified && !!store.payload,
            payload: store.payload || ""
        }));
        const rawIndex = Number(sourceIndex);
        const currentIndex = stores.length
            ? Math.min(Math.max(Number.isInteger(rawIndex) ? rawIndex : 0, 0), stores.length - 1)
            : 0;

        return {
            schemaVersion: CONSTANTS.STORE_CONFIG_VERSION,
            stores,
            currentIndex,
            dingWebhook: readLive('configDingWebhook', state.dingTalkWebhook || ""),
            dingSecret: readLive('configDingSecret', state.dingTalkSecret || ""),
            aiEnable: useDraft
                ? !!document.getElementById('configAiEnable')?.checked
                : localStorage.getItem(CONSTANTS.AI_ENABLE_KEY) === "true",
            aiEndpoint: readLive('configAiEndpoint', localStorage.getItem(CONSTANTS.AI_ENDPOINT_KEY) || ""),
            aiModel: readLive('configAiModel', localStorage.getItem(CONSTANTS.AI_MODEL_KEY) || ""),
            aiKey: readLive('configAiKey', state.aiKey || ""),
            exportTime: new Date().toLocaleString()
        };
    }

    async function exportFullConfig() {
        let configStr = "";
        let storeCount = 0;
        try {
            const backup = buildFullConfigBackup();
            storeCount = backup.stores.length;
            configStr = JSON.stringify(backup, null, 2);
        } catch (err) {
            showError("导出失败: " + err);
            addLog("生成备份数据失败: " + err, "error");
            return;
        }

        if (!storeCount) {
            showSnackbar({ message: "没有可导出的门店配置" });
            addLog("导出终止：门店配置为空", "warn");
            return;
        }

        try {
            await navigator.clipboard.writeText(configStr);
            showSnackbar({ message: `已复制 ${storeCount} 个门店的完整配置（含 Payload / Secret / AI Key 明文）` });
            addLog(`执行完整配置明文导出：${storeCount} 个门店`, "info");
        } catch (err) {
            showFullConfigFallback(configStr);
            addLog("复制到剪贴板失败，已改为手动复制: " + err, "warn");
        }
    }

    function showFullConfigFallback(configStr) {
        const dialog = document.getElementById('exportConfigDialog');
        const output = document.getElementById('exportConfigRawOutput');
        if (!dialog || !output) {
            showError("复制失败，请检查浏览器剪贴板权限");
            return;
        }
        output.value = configStr;
        dialog.open = true;
        setTimeout(() => {
            try { output.select(); } catch (_) { }
        }, 200);
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

        let data;
        try {
            data = JSON.parse(input);
        } catch (err) {
            addLog("导入配置解析失败: " + err, "error");
            showError("解析失败：无效的 JSON 格式，请确保复制了完整的导出文本。");
            return;
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            addLog("导入配置失败: 顶层结构不是对象", "error");
            showError("导入失败：备份内容顶层必须是 JSON 对象。");
            return;
        }

        try {
            if (!Array.isArray(data.stores) || !data.stores.length || data.stores.length > 50) {
                throw new Error("门店配置必须是1至50项的数组");
            }
            const storeKeys = new Set();
            const stores = data.stores.map((item, index) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`门店${index + 1}格式无效`);
                const storeKey = typeof item.storeKey === 'string' && item.storeKey.trim() ? item.storeKey.trim() : createStoreKey();
                if (storeKeys.has(storeKey)) throw new Error("门店稳定ID重复");
                storeKeys.add(storeKey);
                const existingStore = state.storePayloads.find(store => store.storeKey === storeKey)
                    || state.storePayloads.find(store => store.shopName && store.shopName === item.shopName);
                // "***" 仅为兼容早期脱敏导出：沿用本机已有 Payload
                const payload = item.payload === "***"
                    ? (existingStore?.payload || "")
                    : (typeof item.payload === 'string' ? item.payload : "");
                return {
                    storeKey,
                    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `门店${index + 1}`,
                    shopName: typeof item.shopName === 'string' ? item.shopName : "",
                    payload,
                    verified: !!item.verified && !!payload
                };
            });
            const currentIndex = Number(data.currentIndex);
            const safeIndex = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < stores.length ? currentIndex : 0;

            localStorage.setItem(CONSTANTS.STORE_PAYLOADS_KEY, JSON.stringify({ version: CONSTANTS.STORE_CONFIG_VERSION, stores }));
            localStorage.setItem(CONSTANTS.CURRENT_STORE_INDEX_KEY, String(safeIndex));
            if (data.dingWebhook !== undefined && data.dingWebhook !== "***") localStorage.setItem(CONSTANTS.DINGTALK_WEBHOOK_KEY, typeof data.dingWebhook === 'string' ? data.dingWebhook : "");
            if (data.dingSecret !== undefined && data.dingSecret !== "***") localStorage.setItem(CONSTANTS.DINGTALK_SECRET_KEY, typeof data.dingSecret === 'string' ? data.dingSecret : "");
            if (data.aiEnable !== undefined) localStorage.setItem(CONSTANTS.AI_ENABLE_KEY, String(data.aiEnable === true || data.aiEnable === "true"));
            if (data.aiEndpoint !== undefined) localStorage.setItem(CONSTANTS.AI_ENDPOINT_KEY, typeof data.aiEndpoint === 'string' ? data.aiEndpoint : "");
            if (data.aiModel !== undefined) localStorage.setItem(CONSTANTS.AI_MODEL_KEY, typeof data.aiModel === 'string' ? data.aiModel : "");
            if (data.aiKey !== undefined && data.aiKey !== "***") localStorage.setItem(CONSTANTS.AI_KEY_KEY, typeof data.aiKey === 'string' ? data.aiKey : "");

            const restoredCount = stores.filter(store => store.payload).length;
            addLog(`导入配置成功：${stores.length} 个门店，其中 ${restoredCount} 个含 Payload，准备重启应用`, "info");

            document.getElementById('importConfigDialog').open = false;

            mdui.alert({
                headline: "导入成功",
                description: `已恢复 ${stores.length} 个门店（${restoredCount} 个含 Payload），页面将自动刷新以应用更改。`,
                confirmText: "确定",
                onConfirm: () => {
                    window.location.reload();
                }
            });
        } catch (err) {
            addLog("导入配置失败: " + err, "error");
            showError("导入失败：" + (err && err.message ? err.message : err));
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
            if (/PAYLOAD|TOKEN|SECRET|WEBHOOK|AI_PARSE_KEY/i.test(key)) {
                valueInput.type = 'password';
                valueInput.togglePassword = true;
            }

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
        const safeMessage = String(msg || "")
            .replace(/\b1[3-9]\d{9}\b/g, value => `${value.slice(0, 3)}****${value.slice(-4)}`)
            .replace(/\b\d{12,}\b/g, value => `${value.slice(0, 4)}***${value.slice(-4)}`)
            .replace(/(token|secret|webhook|authorization|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=***');

        const logEl = document.createElement('div');
        logEl.className = `log-entry log-level-${level}`;
        logEl.innerHTML = `<span class="log-time">[${escapeHtml(time)}]</span>${escapeHtml(safeMessage)}`;

        container.appendChild(logEl);
        container.scrollTop = container.scrollHeight;

        if (container.children.length > CONSTANTS.LOG_MAX_ENTRIES) {
            container.removeChild(container.firstChild);
        }

        if (level === 'error') console.error(`[${time}] ${safeMessage}`);
        else if (level === 'warn') console.warn(`[${time}] ${safeMessage}`);
        else console.log(`[${time}] ${safeMessage}`);
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
                const parsedStores = Array.isArray(parsed) ? parsed : parsed?.stores;
                if (Array.isArray(parsedStores) && parsedStores.length) {
                    state.storePayloads = parsedStores.map((item, idx) => ({
                        storeKey: typeof item?.storeKey === "string" && item.storeKey.trim() ? item.storeKey.trim() : `legacy_store_${idx}`,
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
                storeKey: "legacy_store_0",
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
        state.storeConfigRevision += 1;
        localStorage.setItem(CONSTANTS.STORE_PAYLOADS_KEY, JSON.stringify({
            version: CONSTANTS.STORE_CONFIG_VERSION,
            stores: state.storePayloads
        }));
        localStorage.setItem(CONSTANTS.CURRENT_STORE_INDEX_KEY, String(state.currentStoreIndex));
        localStorage.setItem(CONSTANTS.CONFIG_KEY, state.storePayloads[state.currentStoreIndex]?.payload || "");
    }

    function renderPayloadInputs() {
        els.payloadList.innerHTML = '';
        const stores = state.configDraft || state.storePayloads;
        const selectedIndex = state.configDraft ? state.configDraftCurrentIndex : state.currentStoreIndex;

        stores.forEach((store, index) => {
            const item = document.createElement('div');
            item.className = `store-item ${index === selectedIndex ? 'active' : ''}`;

            const hasPayload = !!(store.payload && store.payload.trim());
            const stateTag = !hasPayload
                ? '<span class="store-tag store-tag--empty">待填写</span>'
                : store.verified
                    ? '<span class="store-tag store-tag--ok">已验证</span>'
                    : '<span class="store-tag store-tag--warn">未验证</span>';

            item.innerHTML = `
                <div class="store-item-head" data-store-index="${index}">
                    <mdui-radio name="store-payload-radio" value="${index}" ${index === selectedIndex ? 'checked' : ''}></mdui-radio>
                    <div class="store-item-heading">
                        <span class="store-item-name">${escapeHtml(getStoreDisplayName(store, index))}</span>
                        <span class="store-item-meta">
                            <span>门店 ${index + 1}</span>
                            ${index === selectedIndex ? '<span class="store-tag store-tag--current">当前</span>' : ''}
                            ${stateTag}
                        </span>
                    </div>
                    <div class="store-item-actions">
                        <mdui-tooltip content="验证并获取门店名称">
                            <mdui-button-icon icon="verified" class="validate-payload-btn" data-index="${index}"></mdui-button-icon>
                        </mdui-tooltip>
                        <mdui-tooltip content="删除该门店">
                            <mdui-button-icon icon="delete_outline" class="remove-payload-btn" data-index="${index}" style="color: rgb(var(--mdui-color-error));" ${stores.length <= 1 ? 'disabled' : ''}></mdui-button-icon>
                        </mdui-tooltip>
                    </div>
                </div>
                <mdui-text-field
                    class="payload-input"
                    data-payload-index="${index}"
                    label="Login Payload (Code)"
                    variant="outlined"
                    type="password"
                    toggle-password
                    clearable
                ></mdui-text-field>
            `;

            els.payloadList.appendChild(item);
        });

        setTimeout(() => {
            document.querySelectorAll('[data-payload-index]').forEach(input => {
                const idx = Number(input.getAttribute('data-payload-index'));
                input.value = stores[idx]?.payload || "";
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
        if (!state.configDraft) return;
        const inputs = document.querySelectorAll('[data-payload-index]');
        inputs.forEach(input => {
            const idx = Number(input.getAttribute('data-payload-index'));
            if (state.configDraft[idx]) {
                const nextPayload = input.value || "";
                if (state.configDraft[idx].payload !== nextPayload) {
                    state.configDraft[idx].verified = false;
                    state.configDraft[idx].payload = nextPayload;
                }
            }
        });
    }

    function addPayloadEntry() {
        if (!state.configDraft) return;
        syncPayloadsFromInputs();
        state.configDraft.push({
            storeKey: createStoreKey(),
            name: `门店${state.configDraft.length + 1}`,
            payload: "",
            shopName: "",
            verified: false
        });
        renderPayloadInputs();
    }

    function removePayloadEntry(index) {
        if (!state.configDraft) return;
        syncPayloadsFromInputs();

        if (state.configDraft.length <= 1) {
            showSnackbar({ message: "至少需要保留一个门店配置" });
            return;
        }

        const store = state.configDraft[index];
        const storeKey = getStoreKey(store, index);
        const queuedCount = Object.keys(state.orderQueueByStore.stores?.[storeKey]?.orders || {}).length;
        const draftCount = (state.draftsData.drafts?.[storeKey] || []).length;
        if (queuedCount || draftCount) {
            showError(`该门店仍有${queuedCount ? `${queuedCount}个待处理订单` : ''}${queuedCount && draftCount ? '和' : ''}${draftCount ? `${draftCount}个暂存订单` : ''}，请处理后再删除`);
            return;
        }

        mdui.confirm({
            headline: "删除门店配置",
            description: `确定删除 ${getStoreDisplayName(store, index)} 吗？保存设置后才会生效。`,
            confirmText: "删除",
            cancelText: "取消",
            onConfirm: () => {
                if (!state.configDraft) return;
                state.configDraft.splice(index, 1);
                if (state.configDraftCurrentIndex > index) {
                    state.configDraftCurrentIndex -= 1;
                } else if (state.configDraftCurrentIndex >= state.configDraft.length) {
                    state.configDraftCurrentIndex = state.configDraft.length - 1;
                }
                renderPayloadInputs();
            }
        });
    }

    function setCurrentStoreIndex(index, relogin = true) {
        state.currentUiGeneration += 1;
        state.currentStoreIndex = index;
        state.currentToken = ensureStoreRuntime(getCurrentStoreKey()).token || "";
        state.currentUniscid = ensureStoreRuntime(getCurrentStoreKey()).uniscid || "";
        state.currentGoodsUniscid = ensureStoreRuntime(getCurrentStoreKey()).goodsUniscid || "";
        state.regionTree = ensureStoreRuntime(getCurrentStoreKey()).regionTree || {};
        state.loginPayload = state.storePayloads[state.currentStoreIndex]?.payload?.trim() || "";
        persistStorePayloads();
        renderPayloadInputs();
        renderShopSwitchMenu();
        updateShopNameDisplay();

        if (relogin) {
            autoLogin();
        }
    }

    function setConfigDraftCurrentIndex(index) {
        if (!state.configDraft || !state.configDraft[index]) return;
        syncPayloadsFromInputs();
        state.configDraftCurrentIndex = index;
        renderPayloadInputs();
    }

    function updateShopNameDisplay() {
        const currentStore = state.storePayloads[state.currentStoreIndex];
        setTextAnimated(els.shopName, currentStore ? getStoreDisplayName(currentStore, state.currentStoreIndex) : "未获取门店信息");
        schedulePreviewRender();
    }

    function openShopMenu() {
        renderShopSwitchMenu();
        els.shopSwitchMenu.classList.toggle('open');
    }

    async function switchStore(index) {
        els.shopSwitchMenu.classList.remove('open');
        if (index === state.currentStoreIndex) return;
        state.currentDraftId = null;
        stopRemindPolling();
        showRemindBtn(false);
        // 换店等于换了资格上下文，上一位买家的品类不能留在屏幕上
        resetQualificationChips();
        ProductSearch.resetCache();
        setCurrentStoreIndex(index, true);
        updateDraftBadge();
        showSnackbar({ message: `正在切换到 ${getStoreDisplayName(state.storePayloads[index], index)}` });
    }

    async function requestTokenByPayload(rawPayload) {
        const payload = rawPayload ? safeParsePayload(rawPayload) : "";
        try {
            return await fetchWithTimeout(`${CONSTANTS.LONGE_API_BASE}/miniUser/getToken`, {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            addLog("Token请求异常: " + error.message, "error");
            return null;
        }
    }

    async function requestShopInfoByToken(token) {
        try {
            return await fetchWithTimeout(`${CONSTANTS.LONGE_API_BASE}/salesuser/getSalesActivity`, {
                method: 'GET',
                headers: {
                    "Content-Type": "application/json",
                    token
                }
            });
        } catch (error) {
            addLog("门店信息请求异常: " + error.message, "error");
            return null;
        }
    }

    async function validatePayloadEntry(index) {
        if (!state.configDraft) return;
        syncPayloadsFromInputs();
        const store = state.configDraft[index];
        const payloadText = store?.payload?.trim();

        if (!payloadText) {
            return showSnackbar({ message: `门店${index + 1} 的 Payload 不能为空` });
        }

        addLog(`正在验证门店${index + 1} 的Payload...`, "info");
        showSnackbar({ message: `正在验证 ${store.name || `门店${index + 1}`}` });
        const storeKey = getStoreKey(store, index);
        const tokenResult = await requestTokenByPayload(payloadText);
        const tokenValue = tokenResult?.code === 0 ? tokenResult.data : "";

        if (!tokenValue) {
            addLog(`验证失败: Token获取失败`, "error");
            return showError(`验证失败：Token获取失败`);
        }

        const shopRes = await requestShopInfoByToken(tokenValue);
        if (shopRes?.code === 0) {
            const shopName = shopRes.data?.shopInfo?.shopName || store.name || `门店${index + 1}`;
            addLog(`验证成功: ${shopName}`, "info");
            store.shopName = shopName;
            store.name = shopName;
            store.verified = true;
            renderPayloadInputs();
            showSnackbar({ message: `验证成功：${shopName}` });
        } else {
            addLog(`验证失败: ${shopRes?.msg || '无法解析门店信息'}`, "error");
            showError(`验证失败：${shopRes?.msg || '门店信息获取失败'}`);
        }
    }

    async function callApi(endpoint, method = 'GET', data = null, storeKey = getCurrentStoreKey()) {
        const token = await getTokenForStoreKey(storeKey);
        if (!token) {
            addLog(`门店[${getStoreContext(storeKey).storeName}]没有可用Token`, "warn");
            return null;
        }
        try {
            return await callApiWithToken(token, endpoint, method, data, storeKey);
        } catch (error) {
            addLog(`API [${endpoint}] 请求失败`, "error");
            if (storeKey === getCurrentStoreKey()) showError("网络请求失败或跨域被拦截");
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
            return { ok: false, code: "CONFIG_MISSING", message: "未配置钉钉Webhook" };
        }

        addLog("发起钉钉消息推送...", "info");
        try {
            const resData = await fetchWithTimeout(DINGTALK_API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken,
                    secret,
                    content
                })
            });
            if (resData.errcode === 0 || resData.code === 0) {
                addLog("钉钉推送成功响应", "info");
                return { ok: true, code: resData.errcode ?? resData.code, message: resData.errmsg || resData.msg || "ok" };
            } else {
                addLog(`钉钉推送返回错误: ${resData.errmsg || resData.msg}`, "error");
                showSnackbar({ message: "钉钉推送失败: " + (resData.errmsg || resData.msg || "未知错误") });
                return { ok: false, code: resData.errcode ?? resData.code, message: resData.errmsg || resData.msg || "未知错误" };
            }
        } catch (error) {
            addLog("钉钉推送网络异常: " + error.message, "error");
            showSnackbar({ message: "钉钉推送异常，请检查后端服务" });
            return { ok: false, code: "NETWORK_ERROR", message: error.message };
        }
    }

    async function testDingTalk() {
        const webhookUrl = els.dingWebhookInput.value.trim();
        const secretVal = els.dingSecretInput.value.trim();
        if (!webhookUrl) {
            return showSnackbar({ message: "请先填写钉钉 Webhook 地址！" });
        }
        const testMsg = "测试消息：您已成功配置钉钉推送！\n\n张三 13800138000\n江苏省-常州市-武进区-南夏墅街道 城市大厦A座\n12345678\n测试商品\n0.01";
        const result = await sendDingTalkMessage(testMsg, webhookUrl, secretVal);
        showSnackbar({ message: result?.ok ? "测试推送成功" : "测试推送失败" });
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
            `所属门店：${order?.storeName || order?.storeNameSnapshot || "门店配置缺失"}`,
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
        const payOrder = data.payOrder || {};
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
            `所属门店：${payOrder?.storeName || payOrder?.storeNameSnapshot || "门店配置缺失"}`,
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
        // 每轮先做一次过期清理，否则页面长时间不关，TTL 永远没机会执行
        cleanupOrderQueue();
        cleanupOrderPushSentMap();
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

    /** 通知退避时间：与查询退避同一套指数公式，上限 5 分钟 */
    function getNotificationDelay(item) {
        return Math.min(CONSTANTS.ORDER_POLL_INTERVAL_MS * (2 ** Math.min(Number(item?.notificationRetryCount || 0), 6)), 5 * 60 * 1000);
    }

    async function processQueuedOrder(entry, tokenCache) {
        const { storeKey, orderNumber } = entry;
        const readItem = () => state.orderQueueByStore.stores?.[storeKey]?.orders?.[orderNumber];
        let latestItem = readItem();
        if (!latestItem) return;
        const now = Date.now();
        const retryDelay = Math.min(CONSTANTS.ORDER_POLL_INTERVAL_MS * (2 ** Math.min(Number(latestItem.queryRetryCount || 0), 6)), 5 * 60 * 1000);
        if (latestItem.queryLastError && latestItem.queryLastCheckAt && now - latestItem.queryLastCheckAt < retryDelay) return;

        // 卡在“待推送”的订单同样要退避查询，否则会每 5 秒打一次订单详情接口
        if (latestItem.pendingNotification && latestItem.notificationLastAttemptAt
            && now - latestItem.notificationLastAttemptAt < getNotificationDelay(latestItem)) return;

        if (!tokenCache[storeKey]) {
            tokenCache[storeKey] = await getTokenForStoreKey(storeKey);
        }

        // await 之后队列项可能已被补推送/退款流程替换或移除
        if (readItem() !== latestItem) return;

        const token = tokenCache[storeKey];
        if (!token) {
            latestItem.lastCheckAt = now;
            latestItem.queryLastCheckAt = now;
            latestItem.queryRetryCount = Number(latestItem.queryRetryCount || 0) + 1;
            latestItem.queryLastError = "Token 获取失败";
            saveOrderQueue();
            addLog(`无法获取门店[${latestItem.storeNameSnapshot || getStoreContext(storeKey).storeName}]的Token，跳过订单`, "warn");
            return;
        }

        const res = await callApiWithToken(token, '/salesuser/getSalesOrderDetail', 'GET', { orderNumber }, storeKey);
        tokenCache[storeKey] = ensureStoreRuntime(storeKey).token || token;
        if (readItem() !== latestItem) return;
        if (!(res?.code === 0 && res.data?.payOrder)) {
            latestItem.lastCheckAt = now;
            latestItem.queryLastCheckAt = now;
            latestItem.queryRetryCount = Number(latestItem.queryRetryCount || 0) + 1;
            latestItem.queryLastError = res?.msg || "订单详情查询失败";
            saveOrderQueue();
            return;
        }

        const order = attachOrderContext(res.data.payOrder, storeKey, latestItem);
        const newState = Number(order.payState);
        const oldState = Number(latestItem.lastState ?? 0);

        latestItem.lastState = newState;
        latestItem.lastCheckAt = Date.now();
        latestItem.queryLastCheckAt = latestItem.lastCheckAt;
        latestItem.queryRetryCount = 0;
        latestItem.queryLastError = "";
        saveOrderQueue();

        const notificationDelay = getNotificationDelay(latestItem);
        const notificationReady = !latestItem.pendingNotification || !latestItem.notificationLastError || !latestItem.notificationLastAttemptAt || Date.now() - latestItem.notificationLastAttemptAt >= notificationDelay;
        if (newState !== oldState || (latestItem.pendingNotification && notificationReady) || (newState === 2 && !isOrderPushed(storeKey, orderNumber, "PAID") && notificationReady)) {
            await handleOrderStateChange(storeKey, orderNumber, order, newState, oldState, latestItem, res.data);
        }
    }

    async function handleOrderStateChange(storeKey, orderNumber, order, newState, oldState, latestItem, detailData = {}) {
        if (newState !== oldState) {
            addLog(`订单[${orderNumber}]状态变更: ${payStates[oldState] || '未知'} -> ${payStates[newState] || '未知'}`, "info");
        }

        if (newState === 2 && newState !== oldState) {
            showNotification("订单支付成功", `订单号尾号: ${orderNumber.slice(-4)}\n状态: 已付款`);
        }

        if (ORDER_TERMINAL_STATES.includes(newState)) {
            /**
             * 推送失败时是否放弃：达到重试上限或属于不可恢复的配置问题就放弃，
             * 否则订单会永远留在队列里、每轮继续查详情，角标也永远清不掉。
             */
            const shouldGiveUp = (result) => {
                const retried = Number(latestItem.notificationRetryCount || 0) + 1;
                return result?.code === "CONFIG_MISSING" || retried >= CONSTANTS.ORDER_NOTIFY_MAX_RETRIES;
            };

            if (latestItem.pendingNotification === "REFUND" && !isOrderPushed(storeKey, orderNumber, "REFUND")) {
                if (!Array.isArray(detailData.refundOrderVos) || !detailData.refundOrderVos.length) {
                    latestItem.notificationRetryCount = Number(latestItem.notificationRetryCount || 0) + 1;
                    latestItem.notificationLastError = "退款详情尚未就绪";
                    latestItem.notificationLastAttemptAt = Date.now();
                    saveOrderQueue();
                    if (latestItem.notificationRetryCount < CONSTANTS.ORDER_NOTIFY_MAX_RETRIES) return;
                    addLog(`订单[${orderNumber}]退款详情长期未就绪，放弃推送并移出队列`, "warn");
                    latestItem.pendingNotification = "";
                } else {
                    const refundMessage = buildDingTalkRefundMessage({ ...detailData, payOrder: order });
                    const refundPushResult = await sendDingTalkMessage(refundMessage);
                    latestItem.lastPushAt = Date.now();
                    latestItem.notificationLastAttemptAt = latestItem.lastPushAt;
                    if (!refundPushResult?.ok) {
                        const giveUp = shouldGiveUp(refundPushResult);
                        latestItem.notificationRetryCount = Number(latestItem.notificationRetryCount || 0) + 1;
                        latestItem.notificationLastError = refundPushResult?.message || "退款通知推送失败";
                        latestItem.pendingNotification = giveUp ? "" : "REFUND";
                        saveOrderQueue();
                        if (!giveUp) return;
                        addLog(`订单[${orderNumber}]退款通知推送失败已达上限，放弃推送并移出队列: ${latestItem.notificationLastError}`, "error");
                    } else {
                        latestItem.pendingNotification = "";
                        latestItem.notificationRetryCount = 0;
                        latestItem.notificationLastError = "";
                        markOrderPushed(storeKey, orderNumber, "REFUND");
                    }
                }
            }
            if (newState === 2 && !isOrderPushed(storeKey, orderNumber, "PAID")) {
                if (els.qrDialog.open && state.currentQrOrderContext?.storeKey === storeKey && state.currentQrOrderContext?.ccbPayOrderNumber === orderNumber) {
                    els.qrDialog.open = false;
                    showSnackbar({ message: "付款成功！" });
                }

                addLog(`订单[${orderNumber}]支付完成，准备发起推送`, "info");
                const msg = buildDingTalkOrderMessage(order, latestItem.buyerMobile || "");
                const pushResult = await sendDingTalkMessage(msg);
                latestItem.lastPushAt = Date.now();
                latestItem.notificationLastAttemptAt = latestItem.lastPushAt;
                if (!pushResult?.ok) {
                    const giveUp = shouldGiveUp(pushResult);
                    latestItem.notificationRetryCount = Number(latestItem.notificationRetryCount || 0) + 1;
                    latestItem.notificationLastError = pushResult?.message || "钉钉推送失败";
                    latestItem.pendingNotification = giveUp ? "" : "PAID";
                    saveOrderQueue();
                    if (!giveUp) return;
                    addLog(`订单[${orderNumber}]钉钉推送失败已放弃（${latestItem.notificationLastError}），可在订单详情里手动补推送`, "error");
                } else {
                    latestItem.pendingNotification = "";
                    latestItem.notificationRetryCount = 0;
                    latestItem.notificationLastError = "";
                    markOrderPushed(storeKey, orderNumber, "PAID");
                }
            }

            dequeueOrder(storeKey, orderNumber);

            // 只有当前门店的列表才需要刷新，否则会把别的门店已翻的页码重置掉
            if (storeKey === getCurrentStoreKey() && document.getElementById('orderDrawer').open) {
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
        const loginGeneration = ++state.currentUiGeneration;
        const loginIndex = state.currentStoreIndex;
        const storeKey = getCurrentStoreKey();
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

        const token = await refreshTokenForStore(storeKey);

        if (loginGeneration !== state.currentUiGeneration || loginIndex !== state.currentStoreIndex) {
            return;
        }

        if (token) {
            addLog("Token 获取成功", "info");
            const runtime = ensureStoreRuntime(storeKey);
            runtime.token = token;
            runtime.tokenStatus = "valid";
            state.currentToken = token;
            await checkTokenStatus(storeKey, loginGeneration);
            if (loginGeneration === state.currentUiGeneration) fetchRegionData(storeKey, loginGeneration);
        } else {
            addLog(`Token 获取失败`, "error");
            updateStatus(false, "Token获取失败");
            showError(`登录失败: 请检查配置`);
        }
    }

    async function checkTokenStatus(storeKey = getCurrentStoreKey(), uiGeneration = state.currentUiGeneration) {
        const res = await callApi('/salesuser/getSalesActivity', 'GET', null, storeKey);
        if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;
        if (res?.code === 0) {
            addLog("Token 状态校验通过", "info");
            updateStatus(true);
            const shopName = res.data?.shopInfo?.shopName || "";
            const uniscid = res.data?.shopInfo?.uniscid || "";
            const goodsUniscid = res.data?.shopInfo?.goodsUniscid || "";
            if (uniscid) {
                state.currentUniscid = uniscid;
                ensureStoreRuntime(storeKey).uniscid = uniscid;
                addLog(`获取到 uniscid: ${uniscid}`, "info");
            }
            if (goodsUniscid) {
                state.currentGoodsUniscid = goodsUniscid;
                ensureStoreRuntime(storeKey).goodsUniscid = goodsUniscid;
                addLog(`获取到 goodsUniscid: ${goodsUniscid}`, "info");
            }
            if (shopName) {
                setTextAnimated(els.shopName, shopName);
                if (state.storePayloads[state.currentStoreIndex]) {
                    state.storePayloads[state.currentStoreIndex].shopName = shopName;
                    state.storePayloads[state.currentStoreIndex].name = shopName;
                    state.storePayloads[state.currentStoreIndex].verified = true;
                    persistStorePayloads();
                    renderShopSwitchMenu();
                    schedulePreviewRender();
                }
            }
        } else {
            addLog(`Token 校验失败: ${res?.msg}`, "error");
            updateStatus(false, "Token无效");
        }
    }

    function updateStatus(active, text = "") {
        if (active) {
            setTextAnimated(els.statusBadge, "已连接");
            els.statusBadge.classList.add('active');
        } else {
            setTextAnimated(els.statusBadge, text || "未连接");
            els.statusBadge.classList.remove('active');
        }
        updateShopNameDisplay();
    }

    function openConfigDialog() {
        state.configDraft = JSON.parse(JSON.stringify(state.storePayloads));
        state.configDraftCurrentIndex = state.currentStoreIndex;
        renderPayloadInputs();
        els.dingWebhookInput.value = state.dingTalkWebhook;
        els.dingSecretInput.value = state.dingTalkSecret;

        document.getElementById('configAiEnable').checked = state.aiEnable;
        document.getElementById('configAiEndpoint').value = state.aiEndpoint;
        document.getElementById('configAiModel').value = state.aiModel;
        document.getElementById('configAiKey').value = state.aiKey;

        els.configDialog.open = true;
    }

    function closeConfigDialog() {
        els.configDialog.open = false;
        state.configDraft = null;
    }

    function saveConfig() {
        if (!state.configDraft) return closeConfigDialog();
        syncPayloadsFromInputs();

        const validPayloads = state.configDraft.filter(item => item.payload && item.payload.trim());
        if (!validPayloads.length) {
            return showSnackbar({ message: "请至少填写一个 Payload" });
        }

        const previousStoresByKey = new Map(state.storePayloads.map((store, index) => [
            getStoreKey(store, index),
            store,
        ]));
        const nextStores = state.configDraft.map((item, idx) => ({
            ...item,
            name: item.shopName || item.name || `门店${idx + 1}`
        }));

        // 原地替换 payload 等于把这个 storeKey 指向了另一家实体店，
        // 而暂存和待检订单仍绑在旧 key 上，会串店。这里与删除门店同样拦截。
        for (let index = 0; index < nextStores.length; index += 1) {
            const storeKey = getStoreKey(nextStores[index], index);
            const previousStore = previousStoresByKey.get(storeKey);
            if (!previousStore || previousStore.payload === nextStores[index].payload) continue;
            const queuedCount = Object.keys(state.orderQueueByStore.stores?.[storeKey]?.orders || {}).length;
            const draftCount = (state.draftsData.drafts?.[storeKey] || []).length;
            if (queuedCount || draftCount) {
                showError(`${getStoreDisplayName(nextStores[index], index)} 仍有${queuedCount ? `${queuedCount}个待处理订单` : ''}${queuedCount && draftCount ? '和' : ''}${draftCount ? `${draftCount}个暂存订单` : ''}，请先处理完再更换该门店的 Payload`);
                return;
            }
        }

        nextStores.forEach((store, index) => {
            const storeKey = getStoreKey(store, index);
            const previousStore = previousStoresByKey.get(storeKey);
            if (!previousStore || previousStore.payload !== store.payload) {
                delete state.storeRuntimeByKey[storeKey];
            }
            previousStoresByKey.delete(storeKey);
        });
        previousStoresByKey.forEach((_, storeKey) => {
            delete state.storeRuntimeByKey[storeKey];
        });
        state.storePayloads = nextStores;

        state.currentStoreIndex = Math.min(
            Math.max(state.configDraftCurrentIndex, 0),
            state.storePayloads.length - 1,
        );
        state.configDraft = null;
        state.currentUiGeneration += 1;
        // saveConfig 也会改变当前门店，必须和 switchStore 一样重置这些跨门店状态
        state.currentDraftId = null;
        stopRemindPolling();
        showRemindBtn(false);
        resetQualificationChips();
        const currentRuntime = ensureStoreRuntime(getCurrentStoreKey());
        state.currentToken = currentRuntime.token || "";
        state.currentUniscid = currentRuntime.uniscid || "";
        state.currentGoodsUniscid = currentRuntime.goodsUniscid || "";
        state.regionTree = currentRuntime.regionTree || {};

        state.loginPayload = state.storePayloads[state.currentStoreIndex]?.payload?.trim() || "";
        state.dingTalkWebhook = els.dingWebhookInput.value.trim();
        state.dingTalkSecret = els.dingSecretInput.value.trim();

        state.aiEnable = document.getElementById('configAiEnable').checked;
        state.aiEndpoint = document.getElementById('configAiEndpoint').value.trim();
        state.aiModel = document.getElementById('configAiModel').value.trim();
        state.aiKey = document.getElementById('configAiKey').value.trim();

        addLog("用户保存配置并尝试重连", "info");
        persistStorePayloads();
        localStorage.setItem(CONSTANTS.DINGTALK_WEBHOOK_KEY, state.dingTalkWebhook);
        localStorage.setItem(CONSTANTS.DINGTALK_SECRET_KEY, state.dingTalkSecret);

        localStorage.setItem(CONSTANTS.AI_ENABLE_KEY, state.aiEnable);
        localStorage.setItem(CONSTANTS.AI_ENDPOINT_KEY, state.aiEndpoint);
        localStorage.setItem(CONSTANTS.AI_MODEL_KEY, state.aiModel);
        localStorage.setItem(CONSTANTS.AI_KEY_KEY, state.aiKey);

        ProductSearch.resetCache();

        renderPayloadInputs();
        renderShopSwitchMenu();
        updateDraftBadge();
        updateQueueBadge();
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
                schedulePreviewRender();
                setTimeout(() => {
                    if (selectElement.value !== selectedValue) selectElement.value = selectedValue;
                    schedulePreviewRender();
                }, 150);
            }, 50);
        } else {
            selectElement.value = "";
            schedulePreviewRender();
        }
    }

    async function fetchRegionData(storeKey = getCurrentStoreKey(), uiGeneration = state.currentUiGeneration) {
        if (!ensureStoreRuntime(storeKey).token) return;
        const res = await callApi('/salesuser/getTownList', 'GET', null, storeKey);
        if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;
        if (res?.code === 0 && res.data) {
            parseRegionData(res.data, storeKey);
            populateSelect(els.city, Object.keys(state.regionTree));
        }
    }

    function parseRegionData(dataArray, storeKey = getCurrentStoreKey()) {
        const regionTree = {};
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

                                if (!regionTree[cityName]) regionTree[cityName] = {};
                                if (!regionTree[cityName][districtName]) regionTree[cityName][districtName] = [];

                                const validTowns = towns
                                    .filter(t => t.townName?.trim() && t.townCode?.trim())
                                    .map(t => ({ text: t.townName, value: t.townCode }));

                                if (validTowns.length) regionTree[cityName][districtName] = validTowns;
                            }
                        });
                    });
                });
            });
        } catch (e) {
            console.error("地址解析错误", e);
        }
        ensureStoreRuntime(storeKey).regionTree = regionTree;
        state.regionTree = regionTree;
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

    function toggleOrderInput(manualValue) {
        const cb = document.querySelector('#autoOrderNumCheckbox');
        const input = document.querySelector('#shopOrderNumber');
        const wrap = document.querySelector('#shopOrderNumberWrap');
        const auto = cb.checked;
        input.disabled = auto;
        input.value = auto ? "" : (typeof manualValue === 'string' ? manualValue : "");
        animateCollapse(wrap, !auto, 'is-collapsed');
        schedulePreviewRender();
    }

    function openOrderDrawer() {
        initTradeMonthSelect();
        document.getElementById('orderDrawer').open = true;
        fetchOrders();
    }

    function buildOrderQuery() {
        const monthVal = document.getElementById('orderTradeMonth').value;
        const tradeMonth = `${new Date().getFullYear()}-${monthVal}`;
        const payState = document.getElementById('orderPayStateFilter').value;
        const recordState = document.getElementById('orderRecordStateFilter').value;
        const inputStr = document.getElementById('orderSearchMobile').value.trim();
        const storeKey = getCurrentStoreKey();
        const signature = JSON.stringify({ tradeMonth, payState, recordState, inputStr, storeKey, storeConfigRevision: state.storeConfigRevision });
        const baseParams = { tradeMonth, inputStr };
        if (recordState !== '') baseParams.recordState = recordState;
        return { signature, baseParams, payState, groupStates: payStateGroups[payState] || null };
    }

    function createOrderPagingState(groupStates) {
        const groups = {};
        (groupStates || []).forEach(payState => {
            groups[payState] = { page: 1, hasMore: true, fetched: 0, total: null, retryCount: 0, lastError: "" };
        });
        return { normal: { page: 1, hasMore: true, fetched: 0, total: null, retryCount: 0, lastError: "" }, groups };
    }

    async function mapWithConcurrency(items, limit, callback) {
        const results = new Array(items.length);
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) {
                const itemIndex = nextIndex++;
                results[itemIndex] = await callback(items[itemIndex], itemIndex);
            }
        });
        await Promise.all(workers);
        return results;
    }

    async function fetchStoreOrderPage(storeKey, paging, baseParams, payState) {
        if (!paging.hasMore || paging.page > CONSTANTS.ORDER_QUERY_MAX_PAGES) {
            return { orders: [], failed: !!paging.lastError, message: paging.lastError || '' };
        }
        const params = { ...baseParams, pageNumber: String(paging.page) };
        if (payState !== undefined && payState !== null && payState !== '') params.payState = String(payState);
        let res = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            res = await callApi('/salesuser/getShopOrderList', 'GET', params, storeKey);
            if (res?.code === 0 && Array.isArray(res.data)) break;
            if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
        }
        if (!(res?.code === 0 && Array.isArray(res.data))) {
            paging.retryCount = 3;
            paging.lastError = res?.msg || '请求失败';
            paging.hasMore = false;
            return { orders: [], failed: true, message: res?.msg || '请求失败' };
        }

        paging.retryCount = 0;
        paging.lastError = "";
        const pageOrders = res.data.map(order => attachOrderContext(order, storeKey));
        paging.fetched += pageOrders.length;
        paging.total = res.count != null ? Number(res.count) : paging.total;
        paging.page += 1;
        paging.hasMore = paging.page <= CONSTANTS.ORDER_QUERY_MAX_PAGES && (
            paging.total != null ? paging.fetched < paging.total : pageOrders.length > 0
        );
        return { orders: pageOrders, failed: false };
    }

    function mergeOrderResults(existing, additions) {
        const orderMap = new Map();
        [...existing, ...additions].forEach(order => {
            const key = getOrderContextKey(order.storeKey, order.ccbPayOrderNumber || order.storeOrderNumber);
            if (!key || key.endsWith('|')) return;
            const previous = orderMap.get(key);
            orderMap.set(key, previous ? { ...previous, ...order } : order);
        });
        return Array.from(orderMap.values()).sort((a, b) => {
            const timeDiff = new Date(b.createTime || 0).getTime() - new Date(a.createTime || 0).getTime();
            if (timeDiff) return timeDiff;
            const aKey = `${a.ccbPayOrderNumber || ''}|${a.storeOrderNumber || ''}|${a.storeKey || ''}`;
            const bKey = `${b.ccbPayOrderNumber || ''}|${b.storeOrderNumber || ''}|${b.storeKey || ''}`;
            return aKey.localeCompare(bKey);
        });
    }

    async function fetchOrders(page = 1) {
        const container = document.getElementById('orderListContainer');
        const isFirstPage = Number(page) <= 1;
        const query = buildOrderQuery();
        const queryGeneration = isFirstPage ? ++state.orderQueryGeneration : state.orderQueryGeneration;

        if (!state.storePayloads.some(store => store.payload?.trim())) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">请先配置至少一个门店</div>';
            return;
        }

        if (isFirstPage) {
            addLog(`刷新当前门店[${getStoreContext(getCurrentStoreKey()).storeName}]订单列表`, "info");
            container.innerHTML = '<div style="padding: 50px; text-align: center;"><mdui-circular-progress></mdui-circular-progress></div>';
            state.orderSearchResults = [];
            state.orderContextByKey.clear();
            state.orderCurrentPage = 1;
            state.orderHasMore = false;
            state.orderLoadingMore = false;
            state.orderStorePaging = {};
            state.orderQueryFailures = [];
            state.orderQuerySignature = query.signature;
        } else if (state.orderLoadingMore || state.orderQuerySignature !== query.signature) {
            if (state.orderQuerySignature !== query.signature) fetchOrders(1);
            return;
        } else {
            state.orderLoadingMore = true;
        }

        const currentStoreKey = getCurrentStoreKey();
        const storeKeys = getStoreByKey(currentStoreKey)?.payload?.trim() ? [currentStoreKey] : [];
        const results = await mapWithConcurrency(storeKeys, 2, async storeKey => {
            const storePaging = state.orderStorePaging[storeKey] || createOrderPagingState(query.groupStates);
            state.orderStorePaging[storeKey] = storePaging;
            if (query.groupStates) {
                const groupedResults = [];
                for (const payState of query.groupStates) {
                    groupedResults.push(await fetchStoreOrderPage(storeKey, storePaging.groups[payState], query.baseParams, payState));
                    await new Promise(resolve => setTimeout(resolve, 80));
                }
                return { storeKey, orders: groupedResults.flatMap(result => result.orders), failures: groupedResults.filter(result => result.failed) };
            }
            const result = await fetchStoreOrderPage(storeKey, storePaging.normal, query.baseParams, query.payState);
            return { storeKey, orders: result.orders, failures: result.failed ? [result] : [] };
        });

        if (queryGeneration !== state.orderQueryGeneration || state.orderQuerySignature !== query.signature) {
            if (!isFirstPage) state.orderLoadingMore = false;
            return;
        }

        const additions = results.flatMap(result => result.orders);
        const failureMap = new Map(state.orderQueryFailures.map(item => [item.storeKey, item]));
        results.forEach(result => {
            if (result.failures.length) {
                failureMap.set(result.storeKey, {
                    storeKey: result.storeKey,
                    storeName: getStoreContext(result.storeKey).storeName,
                    message: result.failures.map(failure => failure.message).join('；')
                });
            } else {
                failureMap.delete(result.storeKey);
            }
        });
        state.orderQueryFailures = Array.from(failureMap.values());
        state.orderSearchResults = mergeOrderResults(isFirstPage ? [] : state.orderSearchResults, additions);
        state.orderCurrentPage = isFirstPage ? 1 : state.orderCurrentPage + 1;
        state.orderHasMore = Object.values(state.orderStorePaging).some(storePaging => query.groupStates
            ? Object.values(storePaging.groups).some(paging => paging.hasMore)
            : storePaging.normal.hasMore
        );
        state.orderLoadingMore = false;

        addLog(`当前门店订单列表已加载 ${state.orderSearchResults.length} 条`, "info");
        if (!state.orderSearchResults.length) {
            const failureText = state.orderQueryFailures.length
                ? '订单加载失败，请重试'
                : '未找到相关订单';
            container.innerHTML = `<div class="draft-empty" style="grid-column:1/-1;">${escapeHtml(failureText)}</div>`;
            return;
        }
        renderOrderList(container, state.orderSearchResults, state.orderHasMore);
        if (state.orderQueryFailures.length) {
            container.insertAdjacentHTML('afterbegin', '<div style="grid-column:1/-1;padding:8px 12px;color:rgb(var(--mdui-color-error));">订单加载失败，请重试</div>');
        }
    }

    function renderOrderList(container, orders, hasMore = false) {
        container.innerHTML = orders.map(order => {
            const statusText = payStates[order.payState] || "未知";
            const price = Number(order.shopActualPayPrice || 0).toFixed(2);

            let footerContent = '';
            if (order.payState === 0 || order.payState === 1) {
                footerContent = `
                    <mdui-button icon="qr_code_2" variant="tonal" class="open-qr-btn" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}" data-store-key="${escapeHtml(order.storeKey)}">
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
            <div class="order-card" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}" data-store-key="${escapeHtml(order.storeKey)}">
                <div class="card-header">
                    <div>
                        <div class="buyer-name">${escapeHtml(order.shopOrderNumber)}</div>
                        <div class="buyer-mobile">${escapeHtml(order.buyerMobile || '')}</div>
                    </div>
                    <div style="display:flex; align-items: center; gap:4px;">
                        <div class="status-badge status-${order.payState}">${escapeHtml(statusText)}</div>
                            <mdui-button-icon icon="info" variant="standard" class="view-order-detail-btn" data-order-number="${escapeHtml(order.ccbPayOrderNumber)}" data-store-key="${escapeHtml(order.storeKey)}"></mdui-button-icon>
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

            const res = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber: order.ccbPayOrderNumber }, order.storeKey);

            if (res?.code === 0 && res.data?.payOrder) {
                const detail = attachOrderContext(res.data.payOrder, order.storeKey, order);
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
                <span class="huanxin-order-no">${escapeHtml(order.shopOrderNumber || '')}</span>
                <span class="huanxin-price">¥${escapeHtml(price)}</span>
            </div>
        `;
    }

    async function viewOrderDetail(orderNumber, storeKey = "") {
        if (!orderNumber) return showSnackbar({ message: "无效订单号" });

        const context = findOrderContext(storeKey, orderNumber) || attachOrderContext({ ccbPayOrderNumber: orderNumber }, storeKey);
        if (!context.storeKey) return showSnackbar({ message: "订单所属门店未知，无法操作" });
        const requestGeneration = ++state.detailRequestGeneration;
        const requestKey = getOrderContextKey(context.storeKey, orderNumber);

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

        const res = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber }, context.storeKey);
        if (requestGeneration !== state.detailRequestGeneration || requestKey !== getOrderContextKey(context.storeKey, orderNumber)) return;
        loading.style.display = 'none';

        if (res?.code === 0 && res.data?.payOrder) {
            renderOrderDetail(dialog, attachOrderContext(res.data.payOrder, context.storeKey, context), detailPushBtn, res.data.refundOrderVos);
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
                    state.orderToCancel = {
                        storeKey: order.storeKey,
                        storeIndex: order.storeIndex,
                        storeName: order.storeName,
                        shopOrderNumber: order.shopOrderNumber,
                        ccbPayOrderNumber: order.ccbPayOrderNumber
                    };
                    els.confirmDialog.open = true;
                }, 200);
            }, "rgb(var(--mdui-color-error))");
        }

        if (order.payState === 2) {
            state.orderToPush = attachOrderContext(order, order.storeKey);
            detailPushBtn.style.display = 'inline-flex';

            const queuedData = findOrderInQueue(order.ccbPayOrderNumber, order.storeKey);
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
                    state.orderToRefund = {
                        storeKey: order.storeKey,
                        storeIndex: order.storeIndex,
                        storeName: order.storeName,
                        ccbPayOrderNumber: order.ccbPayOrderNumber,
                        shopOrderNumber: order.shopOrderNumber
                    };
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
                    <span class="detail-summary-price-label">实付</span>
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
            setFieldValueAnimated('#goodsCode', goodsCode);
            await queryGoodsInfo();
            if (order.shopOriginalPrice) {
                setFieldValueAnimated('#shopPrice', order.shopOriginalPrice);
                calcPrice();
            }
        }

        els.detailDialog.open = false;
        document.getElementById('orderDrawer').open = false;
        showSnackbar({ message: "已填入订单信息" });
    }

    async function cancelOrder() {
        if (!state.orderToCancel) return;
        const orderContext = state.orderToCancel;
        els.confirmDialog.open = false;
        addLog(`请求取消门店[${orderContext.storeName}]订单`, "info");
        const res = await callApi('/salesuser/cancelWxMiniOrder', 'POST', { shopOrderNumber: orderContext.shopOrderNumber }, orderContext.storeKey);
        if (res?.code === 0) {
            addLog("订单取消成功", "info");
            showSnackbar({ message: "订单取消成功！" });
            fetchOrders();
        } else {
            addLog(`订单取消失败: ${res?.msg}`, "error");
            showError(res?.msg || "取消失败");
        }
        state.orderToCancel = null;
    }

    function closeConfirmDialog() {
        els.confirmDialog.open = false;
        state.orderToCancel = null;
    }

    async function refundOrder() {
        if (!state.orderToRefund) return;
        const orderContext = state.orderToRefund;
        els.refundDialog.open = false;

        addLog(`请求门店[${orderContext.storeName}]发起退款`, "info");
        const payload = {
            shopRefundOrderNumber: "",
            ccbPayOrderNumber: orderContext.ccbPayOrderNumber,
            goodsList: []
        };

        const res = await callApi('/salesuser/auditRefundOrder', 'POST', payload, orderContext.storeKey);

        if (res?.code === 0) {
            addLog("退款请求已接受", "info");
            showSnackbar({ message: "退款成功" });

            const detailRes = await callApi('/salesuser/getSalesOrderDetail', 'GET', { orderNumber: orderContext.ccbPayOrderNumber }, orderContext.storeKey);
            if (detailRes?.code === 0 && detailRes.data && Array.isArray(detailRes.data.refundOrderVos) && detailRes.data.refundOrderVos.length) {
                addLog("获取退款详情成功，准备发起钉钉推送", "info");
                detailRes.data.payOrder = attachOrderContext(detailRes.data.payOrder || {}, orderContext.storeKey, orderContext);
                const msg = buildDingTalkRefundMessage(detailRes.data);
                const pushResult = await sendDingTalkMessage(msg);
                if (pushResult?.ok) {
                    markOrderPushed(orderContext.storeKey, orderContext.ccbPayOrderNumber, "REFUND");
                } else {
                    queueRefundNotification(orderContext, Number(detailRes.data.payOrder?.payState ?? 5), pushResult?.message || "退款通知推送失败");
                    showSnackbar({ message: "退款成功，通知失败，已进入后台重试" });
                }
            } else {
                queueRefundNotification(orderContext, 5, "退款详情尚未就绪");
                showSnackbar({ message: "退款成功，通知将在后台补发" });
            }

            fetchOrders();
        } else {
            addLog(`退款请求失败: ${res?.msg}`, "error");
            showError(res?.msg || "退款请求失败");
        }
        state.orderToRefund = null;
    }

    function queueRefundNotification(orderContext, lastState, lastError) {
        enqueueOrder(orderContext.storeKey, orderContext.ccbPayOrderNumber, {
            ...orderContext,
            storeNameSnapshot: orderContext.storeName,
            lastState,
            lastCheckAt: Date.now(),
            queryRetryCount: 0,
            queryLastError: "",
            pendingNotification: "REFUND",
            notificationRetryCount: 1,
            notificationLastError: lastError,
            notificationLastAttemptAt: Date.now()
        });
        startPolling();
    }

    function closeRefundDialog() {
        els.refundDialog.open = false;
        state.orderToRefund = null;
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
        if (state.isManualPushInProgress) return;
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

        const storeKey = state.orderToPush.storeKey || state.orderToPush._storeKey;
        const orderNumber = state.orderToPush.ccbPayOrderNumber;
        if (orderNumber && isOrderPushed(storeKey, orderNumber, "PAID")) {
            return showSnackbar({ message: "该订单已推送，请勿重复推送" });
        }

        state.isManualPushInProgress = true;
        const confirmPushButton = document.getElementById('confirmPushBtn');
        confirmPushButton.disabled = true;
        addLog(`手动补发门店[${state.orderToPush.storeName}]订单推送`, "info");
        try {
            const msg = buildDingTalkOrderMessage(state.orderToPush, pushMobile);
            const pushResult = await sendDingTalkMessage(msg);
            if (!pushResult?.ok) {
                showSnackbar({ message: "推送失败，订单仍保留在队列中" });
                return;
            }
            showSnackbar({ message: "推送成功" });

            if (orderNumber) {
                dequeueOrder(storeKey, orderNumber);
                markOrderPushed(storeKey, orderNumber, "PAID");
                addLog(`已将订单[${orderNumber}]从本地轮询队列中移除`, "info");
            }

            closePushDialog();
        } finally {
            state.isManualPushInProgress = false;
            confirmPushButton.disabled = false;
        }
    }

    function closePushDialog() {
        els.pushDialog.open = false;
        els.pushMobileInput.value = "";
        state.orderToPush = null;
    }

    function openQrDialog(orderContext) {
        if (!orderContext?.ccbPayOrderNumber || !orderContext?.storeKey) return showSnackbar({ message: "无效的订单上下文" });
        state.currentQrOrderContext = { ...orderContext };
        state.qrRequestGeneration += 1;
        els.qrDialog.open = true;
        loadQrCode();
    }

    function refreshQrCode() {
        if (state.currentQrOrderContext) loadQrCode();
    }

    async function loadQrCode() {
        const requestGeneration = ++state.qrRequestGeneration;
        els.qrLoading.style.display = 'block';
        els.qrImage.style.display = 'none';
        els.qrImage.src = '';

        const orderContext = state.currentQrOrderContext;
        if (!orderContext) return;
        const requestKey = getOrderContextKey(orderContext.storeKey, orderContext.ccbPayOrderNumber);
        addLog(`正在获取门店[${orderContext.storeName}]订单支付二维码`, "info");
        const res = await callApi('/salesuser/getCcbTogetherPayQrCd', 'POST', {
            ccbPayOrderNumber: orderContext.ccbPayOrderNumber
        }, orderContext.storeKey);

        const currentContext = state.currentQrOrderContext;
        if (requestGeneration !== state.qrRequestGeneration || !currentContext || requestKey !== getOrderContextKey(currentContext.storeKey, currentContext.ccbPayOrderNumber)) return;

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

    async function checkQualification() {
        const mobileField = document.getElementById('buyerMobile');
        const mobile = mobileField.value.trim();
        const storeKey = getCurrentStoreKey();
        const uiGeneration = state.currentUiGeneration;
        mobileField.setCustomValidity('');
        if (!mobile) {
            mobileField.setCustomValidity('请输入手机号');
            mobileField.reportValidity();
            return;
        }
        if (!/^1[3-9]\d{9}$/.test(mobile)) {
            mobileField.setCustomValidity('手机号格式不正确');
            mobileField.reportValidity();
            return;
        }
        if (!state.currentToken) {
            mobileField.setCustomValidity('系统未就绪');
            mobileField.reportValidity();
            return;
        }

        addLog(`校验买家资格: ${mobile}`, "info");
        const res = await callApi('/salesuser/queryCustomerChannelSubsidyBalance', 'GET', { buyerMobile: mobile }, storeKey);
        if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey() || mobileField.value.trim() !== mobile) return;

        if (res?.code === 0) {
            // data 可能为 null（未知买家），不能直接取属性，否则 async 处理器抛错、按钮看起来没反应
            const data = res.data || {};
            addLog(`资格查询成功，返点Code: ${data.countrySubsidyCateCodes || '无'}`, "info");
            const validCodes = applyQualificationToChips(data);

            if (validCodes.length > 0) {
                showSnackbar({ message: `查询成功`, closeable: true });
                stopRemindPolling();
                showRemindBtn(false);
            } else {
                showSnackbar({ message: `查询成功，尚未领取品类资格`, closeable: true });
                showRemindBtn(true);
            }
        } else {
            const errMsg = res?.msg || "查询无响应";
            addLog(`资格查询失败: ${errMsg}`, "error");
            mobileField.setCustomValidity(errMsg);
            mobileField.reportValidity();
            resetQualificationChips();
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

    /** 把资格接口返回的品类信息刷到 chips 上，返回命中的品类码 */
    function applyQualificationToChips(data) {
        const chips = document.querySelectorAll('#productCategoryChips mdui-chip');
        chips.forEach(c => {
            if (!c.dataset.originalText) c.dataset.originalText = c.textContent;
        });
        const validCodes = String(data?.countrySubsidyCateCodes || "").split(',').map(c => c.trim()).filter(c => c);
        const cityMap = {};
        (data?.cateCodeList || []).forEach(item => {
            if (item?.cityName) cityMap[item.cateCode] = item;
        });
        chips.forEach(c => {
            c.selected = validCodes.includes(c.value);
            const info = cityMap[c.value];
            if (info) {
                const city = String(info.cityName || '').replace(/市$/, '');
                const modeText = info.mode === '0' ? '线上' : '线下';
                c.textContent = `${c.dataset.originalText}（${city}${modeText}）`;
            } else {
                c.textContent = c.dataset.originalText;
            }
        });
        sortSelectedChipsToTop();
        return validCodes;
    }

    /** 清空 chips 的选中与标注，换手机号或查询失败时调用 */
    function resetQualificationChips() {
        document.querySelectorAll('#productCategoryChips mdui-chip').forEach(c => {
            if (!c.dataset.originalText) c.dataset.originalText = c.textContent;
            c.selected = false;
            c.textContent = c.dataset.originalText;
        });
        sortSelectedChipsToTop();
    }

    function startRemindPolling() {
        if (state.isRemindPolling) return;
        const mobile = document.getElementById('buyerMobile').value.trim();
        const storeKey = getCurrentStoreKey();
        const uiGeneration = state.currentUiGeneration;
        if (!mobile || !state.currentToken) return;

        state.isRemindPolling = true;
        state.remindPollAttempts = 0;
        state.remindPollInFlight = false;
        const btn = document.getElementById('remindQualificationBtn');
        btn.innerHTML = '<mdui-circular-progress style="width:16px;height:16px;margin-right:4px;"></mdui-circular-progress>轮询中';
        btn.disabled = true;
        addLog(`开始轮询资格核验[${mobile}]`, "info");

        state.remindPollTimer = setInterval(async () => {
            // 上一次请求还没回来就跳过这一拍，避免请求堆积
            if (state.remindPollInFlight) return;

            const currentMobile = document.getElementById('buyerMobile').value.trim();
            if (currentMobile !== mobile) {
                stopRemindPolling();
                showRemindBtn(false);
                return;
            }
            if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) {
                stopRemindPolling();
                return;
            }
            state.remindPollAttempts = Number(state.remindPollAttempts || 0) + 1;
            if (state.remindPollAttempts > CONSTANTS.REMIND_POLL_MAX_ATTEMPTS) {
                addLog(`资格核验轮询已达上限(${CONSTANTS.REMIND_POLL_MAX_ATTEMPTS} 次)，停止轮询`, "warn");
                stopRemindPolling();
                showSnackbar({ message: "长时间未检测到领券，已停止轮询，可手动重新核验", closeable: true });
                return;
            }

            state.remindPollInFlight = true;
            let res = null;
            try {
                addLog(`轮询资格核验: ${mobile}`, "info");
                res = await callApi('/salesuser/queryCustomerChannelSubsidyBalance', 'GET', { buyerMobile: mobile }, storeKey);
            } catch (e) {
                addLog(`资格核验轮询异常: ${e.message}`, "error");
                return;
            } finally {
                state.remindPollInFlight = false;
            }

            // 响应回来时手机号/门店/轮询状态都可能已经变了，逐项确认后再动 UI
            if (uiGeneration !== state.currentUiGeneration
                || storeKey !== getCurrentStoreKey()
                || !state.isRemindPolling
                || document.getElementById('buyerMobile').value.trim() !== mobile) return;

            if (res?.code === 0) {
                const validCodes = applyQualificationToChips(res.data || {});
                if (validCodes.length > 0) {
                    addLog(`资格核验轮询成功，已获得品类`, "info");
                    stopRemindPolling();
                    showRemindBtn(false);
                    document.getElementById('remindSuccessDialog').open = true;
                }
            }
        }, CONSTANTS.REMIND_POLL_INTERVAL_MS);
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

    const CHIP_COLLAPSED_HEIGHT = 35;
    const _collapseFinishers = new WeakMap();

    function prefersReducedMotion() {
        return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }

    /** 重播一次性动画：先摘类名并强制回流，避免连续变化时动画不触发 */
    function playOneShotAnimation(el, animationClass) {
        if (!el || prefersReducedMotion()) return;
        el.classList.remove(animationClass);
        void el.offsetWidth;
        el.classList.add(animationClass);
        el.addEventListener('animationend', function onEnd(e) {
            if (e.target !== el) return;
            el.removeEventListener('animationend', onEnd);
            el.classList.remove(animationClass);
        });
    }

    /** 文本变化时才改写并播放动画，内容没变不打扰 */
    function setTextAnimated(el, text, animationClass = 'text-swap') {
        if (!el) return;
        const next = String(text ?? '');
        if (el.textContent === next) return;
        el.textContent = next;
        playOneShotAnimation(el, animationClass);
    }

    /** 程序自动回填的输入框：值变化时高亮一下，提示这不是用户自己敲的 */
    function setFieldValueAnimated(selector, value) {
        const el = document.querySelector(selector);
        if (!el) return;
        const next = String(value ?? '');
        if (el.value === next) return;
        el.value = next;
        playOneShotAnimation(el, 'field-flash');
    }

    /**
     * 自动回填价格字段：只有当前值为空、或仍等于上次自动填入的值时才覆盖，
     * 避免商品查询的延迟响应顶掉操作员刚手输的价格。force=true 用于清空。
     * @returns {boolean} 是否真的写入
     */
    function setAutoFilledPrice(selector, value, force = false) {
        const el = document.querySelector(selector);
        if (!el) return false;
        const next = String(value ?? '');
        const current = String(el.value ?? '');
        const isUntouched = !current.trim() || current === (el.dataset.autoFilled ?? '');
        if (!force && !isUntouched) return false;
        setFieldValueAnimated(selector, next);
        el.dataset.autoFilled = next;
        return true;
    }

    /**
     * 折叠/展开高度过渡：先量当前高度作为起点，切换类名后量目标高度，
     * 用内联 max-height 驱动 CSS transition，结束后交还给类名控制。
     */
    function animateCollapse(el, expanded, collapsedClass, collapsedHeight = 0) {
        if (!el) return;

        const pending = _collapseFinishers.get(el);
        if (pending) pending();

        const startHeight = el.getBoundingClientRect().height;
        el.classList.toggle(collapsedClass, !expanded);
        const endHeight = expanded ? el.scrollHeight : collapsedHeight;

        if (startHeight === endHeight || prefersReducedMotion()) {
            el.style.maxHeight = '';
            return;
        }

        el.style.maxHeight = `${startHeight}px`;
        void el.offsetHeight;
        el.style.maxHeight = `${endHeight}px`;

        const finish = () => {
            clearTimeout(timer);
            el.removeEventListener('transitionend', onTransitionEnd);
            _collapseFinishers.delete(el);
            el.style.maxHeight = '';
        };
        const onTransitionEnd = (e) => {
            if (e.target === el && e.propertyName === 'max-height') finish();
        };
        const timer = setTimeout(finish, 600);

        el.addEventListener('transitionend', onTransitionEnd);
        _collapseFinishers.set(el, finish);
    }

    function toggleChipExpand() {
        const container = document.getElementById('productCategoryChips');
        const btn = document.getElementById('chipExpandBtn');
        const expand = container.classList.contains('collapsed');
        animateCollapse(container, expand, 'collapsed', CHIP_COLLAPSED_HEIGHT);
        btn.innerText = expand ? '收起' : '展开全部';
    }

    async function queryGoodsInfo() {
        const code = document.querySelector('#goodsCode').value;
        if (!code || !state.currentToken) {
            _pendingGoodsQuery = null;
            return;
        }

        const storeKey = getCurrentStoreKey();
        const uiGeneration = state.currentUiGeneration;
        addLog(`查询商品信息: ${code}`, "info");
        const pendingQuery = callApi('/salesuser/queryGoodsInfo', 'GET', { goodsCode: code, uniscid: "" }, storeKey);
        _pendingGoodsQuery = pendingQuery;
        try {
            const res = await pendingQuery;
            if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey() || document.querySelector('#goodsCode').value !== code) return;
            if (res?.code === 0 && res.data) {
                if (res.data.id == null) {
                    addLog(`商品[${code}]未备案或已吊销`, "error");
                    showError(`商品未备案或已吊销`);
                    document.querySelector('#goodsCode').dataset.goodsName = "";
                    setAutoFilledPrice('#filingPrice', "", true);
                    setAutoFilledPrice('#shopPrice', "", true);
                    delete document.querySelector('#shopPrice').dataset.autoFilledFor;
                    clearDerivedPrices();
                    validateShopPriceAgainstFiling();
                    renderRecentGoodsSelect("");
                    return;
                }
                document.querySelector('#goodsCode').dataset.goodsName = res.data.goodsName;
                saveRecentGoods(code, res.data.goodsName);

                const shopEl = document.querySelector('#shopPrice');
                // 换了另一个商品（含点选最近记录、商品库导入）时必须重置价格；
                // 同一商品重复查询则保留操作员手输的门店单价。
                const isDifferentGoods = shopEl.dataset.autoFilledFor !== code;
                setAutoFilledPrice('#filingPrice', res.data.subsidyBackPrice, isDifferentGoods);

                const filing = parsePriceInput(res.data.subsidyBackPrice);
                let suggestedShopPrice = res.data.subsidyBackPrice;
                if (Number.isFinite(filing) && filing > 10000) {
                    // 超过一万的商品：门店单价取 1 万加随机零头，且不超过备案价
                    const maxFloat = Math.floor(Math.min(filing - 10000, 1000));
                    const float = Math.floor(Math.random() * (maxFloat + 1));
                    suggestedShopPrice = formatPrice(10000 + float);
                }
                if (setAutoFilledPrice('#shopPrice', suggestedShopPrice, isDifferentGoods)) {
                    shopEl.dataset.autoFilledFor = code;
                    calcPrice();
                } else {
                    addLog("门店单价已手动填写，保留手输值不做覆盖", "warn");
                    validateShopPriceAgainstFiling();
                    schedulePreviewRender();
                }
            } else {
                addLog(`商品[${code}]查询失败`, "error");
                showError(`商品查询失败: ${res?.msg}`);
                document.querySelector('#goodsCode').dataset.goodsName = "";
                renderRecentGoodsSelect("");
            }
        } finally {
            if (_pendingGoodsQuery === pendingQuery) _pendingGoodsQuery = null;
            schedulePreviewRender();
        }
    }

    let _calcGuard = false;
    let _pendingGoodsQuery = null;

    function round2(v) {
        return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
    }

    function formatPrice(v) {
        const n = round2(v);
        return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
    }

    /** 统一价格解析：允许 ¥ ￥ 千分位 空格 与「元」，非法返回 NaN */
    function parsePriceInput(value) {
        if (value === null || value === undefined) return NaN;
        const cleaned = String(value).replace(/[¥￥,，\s元]/g, '');
        if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return NaN;
        const num = Number(cleaned);
        return Number.isFinite(num) ? num : NaN;
    }

    function readPriceField(selector) {
        return parsePriceInput(document.querySelector(selector)?.value);
    }

    /** 正向公式：门店价 -> 实付价（唯一真源，正反算共用） */
    function shopPriceToActual(shopPrice) {
        return shopPrice <= 10000 ? shopPrice * 0.85 : 8500 + (shopPrice - 10000);
    }

    /**
     * 反向公式：实付价 -> 门店价。
     * 同一个实付价可能对应相邻两个门店价（都能四舍五入回同一分），
     * 因此优先保留当前门店价，其次才取公式值，避免重复输入同一实付时门店价来回漂移 1 分。
     */
    function actualToShopPrice(actualPrice, preferredShopPrice = NaN) {
        const target = round2(actualPrice);
        if (Number.isFinite(preferredShopPrice) && preferredShopPrice > 0
            && round2(shopPriceToActual(round2(preferredShopPrice))) === target) {
            return round2(preferredShopPrice);
        }
        const raw = actualPrice <= 8500 ? actualPrice / 0.85 : 10000 + (actualPrice - 8500);
        const base = round2(raw);
        for (const candidate of [base, round2(base - 0.01), round2(base + 0.01)]) {
            if (round2(shopPriceToActual(candidate)) === target) return candidate;
        }
        return base;
    }

    /** 按门店价写回三个字段，保证 实付 + 补贴 === 门店价（分币级一致） */
    function applyPriceTriple(shopPrice) {
        const shop = round2(shopPrice);
        const actual = round2(shopPriceToActual(shop));
        const subsidy = round2(shop - actual);
        _calcGuard = true;
        try {
            setFieldValueAnimated('#shopPrice', formatPrice(shop));
            setFieldValueAnimated('#actualPrice', formatPrice(actual));
            setFieldValueAnimated('#subsidyPrice', formatPrice(subsidy));
        } finally {
            _calcGuard = false;
        }
        schedulePreviewRender();
    }

    function clearDerivedPrices() {
        _calcGuard = true;
        try {
            setFieldValueAnimated('#actualPrice', '');
            setFieldValueAnimated('#subsidyPrice', '');
        } finally {
            _calcGuard = false;
        }
        schedulePreviewRender();
    }

    /**
     * 门店单价不得高于备案价。这里不再静默夹取，而是红框标注 + 校验信息，
     * 让操作员自己决定改哪个价（提交前的校验仍会拦截）。
     */
    function validateShopPriceAgainstFiling() {
        const shopEl = document.querySelector('#shopPrice');
        if (!shopEl) return false;
        const shopPrice = readPriceField('#shopPrice');
        const filingPrice = readPriceField('#filingPrice');
        const over = Number.isFinite(shopPrice) && Number.isFinite(filingPrice)
            && filingPrice > 0 && round2(shopPrice) > round2(filingPrice);

        shopEl.classList.toggle('field-over-limit', over);
        // setCustomValidity 交给 mdui 渲染红色提示文案，红色边框由 .field-over-limit 负责
        shopEl.setCustomValidity(over ? `门店单价不得高于备案价 ${formatPrice(filingPrice)}` : '');
        return over;
    }

    function calcPrice() {
        if (_calcGuard) return;
        const shopPrice = readPriceField('#shopPrice');
        if (!Number.isFinite(shopPrice) || shopPrice <= 0) {
            clearDerivedPrices();
            validateShopPriceAgainstFiling();
            return;
        }
        applyPriceTriple(shopPrice);
        validateShopPriceAgainstFiling();
    }

    function reverseCalcPrice() {
        if (_calcGuard) return;
        const actualPrice = readPriceField('#actualPrice');
        if (!Number.isFinite(actualPrice) || actualPrice <= 0) {
            _calcGuard = true;
            try {
                setFieldValueAnimated('#subsidyPrice', '');
            } finally {
                _calcGuard = false;
            }
            schedulePreviewRender();
            return;
        }
        applyPriceTriple(actualToShopPrice(actualPrice, readPriceField('#shopPrice')));
        validateShopPriceAgainstFiling();
    }

    let _previewRafId = null;

    function schedulePreviewRender() {
        if (_previewRafId) return;
        _previewRafId = requestAnimationFrame(() => {
            _previewRafId = null;
            renderOrderPreview();
        });
    }

    function formatReceiptMoney(value) {
        if (value === "" || value === null || value === undefined) return "";
        const num = Number(value);
        if (!Number.isFinite(num)) return "";
        return `¥${num.toFixed(2)}`;
    }

    function buildReceiptAddress(formData) {
        const region = [formData.city, formData.district, formData.townName].filter(Boolean).join("");
        return [region, formData.detailAddress].filter(Boolean).join(" ");
    }

    function readReceiptValues(container) {
        const map = new Map();
        container.querySelectorAll('[data-receipt-key]').forEach(el => {
            map.set(el.dataset.receiptKey, el.textContent.replace(/\s+/g, ' ').trim());
        });
        return map;
    }

    /** 小票每行对应的来源输入框，用户正在这个框里打字时该行不做动画，避免逐字闪动 */
    const RECEIPT_KEY_SOURCE_ID = {
        name: 'buyerName',
        mobile: 'buyerMobile',
        address: 'detailAddress',
        goods: 'goodsCode',
        filing: 'filingPrice',
        shop: 'shopPrice',
        subsidy: 'subsidyPrice',
        total: 'actualPrice'
    };

    /** 小票每次整体重绘，这里只给内容真的变了的那几行补上动画 */
    function animateChangedReceiptValues(container, prevValues) {
        if (!prevValues.size || prefersReducedMotion()) return;
        const activeId = document.activeElement?.id || '';
        container.querySelectorAll('[data-receipt-key]').forEach(el => {
            const key = el.dataset.receiptKey;
            if (!prevValues.has(key)) return;
            if (prevValues.get(key) === el.textContent.replace(/\s+/g, ' ').trim()) return;
            if (activeId && RECEIPT_KEY_SOURCE_ID[key] === activeId) return;
            el.classList.add(key === 'total' ? 'value-pop' : 'text-swap');
        });
    }

    function renderOrderPreview() {
        const container = document.getElementById('orderPreview');
        if (!container) return;

        const fd = collectCurrentFormData();
        const addressText = buildReceiptAddress(fd);
        const hasContent = !!(fd.buyerName || fd.buyerMobile || addressText || fd.goodsCode
            || fd.goodsName || fd.shopPrice || fd.actualPrice);

        if (!hasContent) {
            container.innerHTML = '<div class="receipt-empty">填写订单信息后自动生成小票预览</div>';
            return;
        }

        const currentStore = state.storePayloads[state.currentStoreIndex];
        const storeName = currentStore
            ? getStoreDisplayName(currentStore, state.currentStoreIndex)
            : "未获取门店信息";
        const subsidyText = formatReceiptMoney(fd.subsidyPrice);

        const amountRow = (label, value, key, extraClass = "") => value
            ? `<div class="receipt-amount ${extraClass}">
                    <span class="receipt-amount-label">${escapeHtml(label)}</span>
                    <span class="receipt-amount-value" data-receipt-key="${key}">${escapeHtml(value)}</span>
                </div>`
            : '';

        const infoRow = (label, value, key) => `
            <div class="receipt-row">
                <span class="receipt-label">${escapeHtml(label)}</span>
                <span class="receipt-value" data-receipt-key="${key}">${escapeHtml(value || '未填写')}</span>
            </div>`;

        const prevValues = readReceiptValues(container);

        container.innerHTML = `
            <div class="receipt-head">
                <span class="receipt-title">销售小票</span>
                <span class="receipt-sub" data-receipt-key="store">${escapeHtml(storeName)}</span>
            </div>
            <div class="receipt-divider"></div>
            ${infoRow('姓名', fd.buyerName, 'name')}
            ${infoRow('电话', fd.buyerMobile, 'mobile')}
            ${infoRow('地址', addressText, 'address')}
            <div class="receipt-divider"></div>
            <div class="receipt-row">
                <span class="receipt-label">商品</span>
                <span class="receipt-value" data-receipt-key="goods">
                    <span class="receipt-goods-name">${escapeHtml(fd.goodsName || '未查询到商品')}</span>
                </span>
            </div>
            <div class="receipt-divider"></div>
            ${amountRow('备案价', formatReceiptMoney(fd.filingPrice), 'filing')}
            ${amountRow('门店单价', formatReceiptMoney(fd.shopPrice), 'shop')}
            ${amountRow('政府补贴', subsidyText ? `-${subsidyText}` : '', 'subsidy', 'receipt-amount--discount')}
            <div class="receipt-divider"></div>
            <div class="receipt-total">
                <span class="receipt-total-label">实付合计</span>
                <span class="receipt-total-value" data-receipt-key="total">${escapeHtml(formatReceiptMoney(fd.actualPrice) || '¥0.00')}</span>
            </div>
        `;

        animateChangedReceiptValues(container, prevValues);
    }

    /** 把 "XS0042" 递增成 "XS0043"，保持前缀与补零宽度 */
    function incrementOrderNumber(orderNumber) {
        const match = String(orderNumber || '').trim().match(/^(.*?)(\d+)$/);
        if (!match) return String(orderNumber || '');
        const [, prefix, digits] = match;
        return `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
    }

    function getPreviousTradeMonth(tradeMonth) {
        const match = String(tradeMonth || '').match(/^(\d{4})-(\d{1,2})$/);
        if (!match) return "";
        const year = Number(match[1]);
        const month = Number(match[2]);
        const date = new Date(year, month - 1, 1);
        date.setMonth(date.getMonth() - 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    /** 拉取指定门店某个月的全部订单；失败抛错由调用方决定是否容忍 */
    async function fetchStoreOrdersForMonth(storeKey, tradeMonth) {
        const orders = [];
        let pageNumber = 1;
        let total = null;
        let lastPageFull = false;
        while (pageNumber <= CONSTANTS.ORDER_QUERY_MAX_PAGES) {
            const res = await callApi('/salesuser/getShopOrderList', 'GET', {
                tradeMonth,
                inputStr: "",
                pageNumber: String(pageNumber)
            }, storeKey);
            if (!(res?.code === 0 && Array.isArray(res.data))) {
                throw new Error(`门店[${getStoreContext(storeKey).storeName}]订单单号查询失败`);
            }
            orders.push(...res.data);
            total = res.count != null ? Number(res.count) : total;
            lastPageFull = res.data.length > 0;
            if (!res.data.length || (total != null && orders.length >= total)) return orders;
            pageNumber += 1;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        // 只有最后一页仍是满的才说明确实没读完
        if (lastPageFull) {
            throw new Error(`门店[${getStoreContext(storeKey).storeName}]订单分页超过安全上限，请改用手动单号`);
        }
        return orders;
    }

    function collectOrderNumberPatterns(orders) {
        return orders.map(order => String(order?.shopOrderNumber || '').trim())
            .map(value => {
                const match = value.match(/^(.*?)(\d+)$/);
                return match ? { value, prefix: match[1], digits: match[2], number: Number(match[2]) } : null;
            })
            .filter(item => item && Number.isSafeInteger(item.number));
    }

    /**
     * 按全门店历史单号推算下一个单号。
     * - 当月没有订单时回退到上一个月，避免月初退化成裸 "1"
     * - 提交门店必须查询成功，其他门店失败只记日志不阻断
     */
    async function generateNextOrderNumber(submitStoreKey = getCurrentStoreKey()) {
        const storeKeys = state.storePayloads
            .map((store, index) => getStoreKey(store, index))
            .filter(storeKey => !!getStoreByKey(storeKey)?.payload?.trim());

        const collectPatterns = async (tradeMonth) => {
            const storeResults = await mapWithConcurrency(storeKeys, 2, async storeKey => {
                try {
                    return await fetchStoreOrdersForMonth(storeKey, tradeMonth);
                } catch (e) {
                    if (storeKey === submitStoreKey) throw e;
                    addLog(`跳过门店[${getStoreContext(storeKey).storeName}]单号查询: ${e.message}`, "warn");
                    return [];
                }
            });
            return collectOrderNumberPatterns(storeResults.flat());
        };

        const currentMonth = getDefaultTradeMonth();
        let tradeMonth = currentMonth;
        let patterns = await collectPatterns(tradeMonth);
        if (!patterns.length) {
            const previousMonth = getPreviousTradeMonth(currentMonth);
            if (previousMonth) {
                addLog(`${currentMonth} 无历史单号，回退查询 ${previousMonth}`, "warn");
                tradeMonth = previousMonth;
                patterns = await collectPatterns(tradeMonth);
            }
        }
        if (!patterns.length) {
            throw new Error("未查询到历史销售单号，无法推算，请取消“自动单号”并手动填写");
        }

        const prefixes = new Set(patterns.map(item => item.prefix));
        if (prefixes.size !== 1) {
            throw new Error(`历史销售单号存在多个前缀格式（${[...prefixes].map(p => p || '空').join(' / ')}），请改用手动单号`);
        }
        const maxItem = patterns.reduce((max, item) => item.number > max.number ? item : max);
        // 补零宽度取历史最宽的，避免 0009 与 10 混存时把 4 位约定丢掉
        const width = Math.max(...patterns.map(item => item.digits.length));
        const nextNumber = `${maxItem.prefix}${String(maxItem.number + 1).padStart(width, '0')}`;
        addLog(`${tradeMonth} 全门店销售单号最大值为 ${maxItem.value}，下一单号为 ${nextNumber}`, "info");
        return nextNumber;
    }

    async function submitOrder() {
        if (state.isSubmittingOrder) return showSnackbar({ message: "订单正在提交，请勿重复点击" });
        state.isSubmittingOrder = true;
        const submitButton = document.getElementById('submitOrderBtn');
        submitButton.disabled = true;
        const submitStoreKey = getCurrentStoreKey();
        const submitStoreContext = getStoreContext(submitStoreKey);
        const submitUiGeneration = state.currentUiGeneration;
        try {
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }

        if (!await getTokenForStoreKey(submitStoreKey)) return showError("Token 未就绪");

        if (_pendingGoodsQuery) {
            addLog("等待商品信息查询完成...", "info");
            try { await _pendingGoodsQuery; } catch (_) { /* 查询异常已在 queryGoodsInfo 中处理 */ }
        }

        if (submitUiGeneration !== state.currentUiGeneration || submitStoreKey !== getCurrentStoreKey()) {
            return showError("提交期间门店已切换，本次提交已取消");
        }

        addLog("开始收集表单并提交订单...", "info");
        const mobile = document.querySelector('#buyerMobile').value.trim();
        const goodsCode = document.querySelector('#goodsCode').value.trim();
        const detailAddr = document.querySelector('#detailAddress').value;
        const city = els.city.value;
        const district = els.district.value;
        const townCode = els.town.value;

        const actualGoodsName = document.querySelector('#goodsCode').dataset.goodsName || "";

        if (!mobile || !goodsCode || !city || !district || !townCode || !actualGoodsName) {
            return showError("请填写完整订单信息（注意确认商品查询成功及乡镇地址）");
        }
        if (!/^1[3-9]\d{9}$/.test(mobile)) {
            return showError("手机号格式不正确");
        }

        // 三个金额必须都有效，且 实付 + 补贴 === 门店价，避免清空某一项后提交出 0 元或负补贴订单
        const shopPriceNum = readPriceField('#shopPrice');
        const actualNum = readPriceField('#actualPrice');
        const subsidyNum = readPriceField('#subsidyPrice');
        const filingNum = readPriceField('#filingPrice');
        if (![shopPriceNum, actualNum, subsidyNum].every(v => Number.isFinite(v) && v >= 0) || shopPriceNum <= 0 || actualNum <= 0) {
            return showError("价格填写不完整或格式有误，请重新确认门店单价与实付单价");
        }
        if (round2(actualNum + subsidyNum) !== round2(shopPriceNum)) {
            return showError(`金额不一致：实付 ${formatPrice(actualNum)} + 补贴 ${formatPrice(subsidyNum)} ≠ 门店单价 ${formatPrice(shopPriceNum)}，请重新计算`);
        }
        if (!Number.isFinite(filingNum) || filingNum <= 0) {
            return showError("备案价缺失，请重新查询商品信息");
        }
        if (round2(shopPriceNum) > round2(filingNum)) {
            return showError(`门店单价 ${formatPrice(shopPriceNum)} 高于备案价 ${formatPrice(filingNum)}，请修正`);
        }

        const useAutoOrderNumber = document.querySelector('#autoOrderNumCheckbox').checked;
        let shopOrderNum = document.querySelector('#shopOrderNumber').value.trim();
        if (useAutoOrderNumber) {
            try {
                showSnackbar({ message: "正在获取最新单号..." });
                shopOrderNum = await generateNextOrderNumber(submitStoreKey);
            } catch (e) {
                return showError(e?.message || "自动获取单号失败");
            }
        } else if (!shopOrderNum) {
            return showError("请填写销售单号，或勾选“自动单号”");
        }

        if (submitUiGeneration !== state.currentUiGeneration || submitStoreKey !== getCurrentStoreKey()) {
            return showError("提交期间门店已切换，本次提交已取消");
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
            shopActualPayPrice: round2(actualNum).toFixed(2),
            shopOriginalPrice: round2(shopPriceNum).toFixed(2),
            subsidyTotalAmount: round2(subsidyNum).toFixed(2),
            goodsVoList: [{
                goodsCode,
                goodsName: actualGoodsName,
                goodsCount: 1,
                shopGoodsActualPayPrice: round2(actualNum),
                shopGoodsOriginalPrice: round2(shopPriceNum),
                subsidyAmount: round2(subsidyNum),
                uniscid: ""
            }],
            buyerName,
            uniscid: "",
            address: addressStr,
            townCode
        };

        addLog(`订单详情: [${shopOrderNum}] 实付:${formatPrice(actualNum)} 买家:${mobile} 地址:${addressStr.slice(0, 10)}...`, "info");
        let res = await callApi('/salesuser/addOrder', 'POST', payload, submitStoreKey);
        const conflictMessage = String(res?.msg || '');
        if (res?.code !== 0 && useAutoOrderNumber && /已存在|重复|占用|duplicate/i.test(conflictMessage)) {
            // 单号冲突时本地递增，重新查询只会拿到同一个值
            const retryNumber = incrementOrderNumber(payload.shopOrderNumber);
            addLog(`销售单号[${payload.shopOrderNumber}]冲突，改用 ${retryNumber} 重试一次`, "warn");
            payload.shopOrderNumber = retryNumber;
            res = await callApi('/salesuser/addOrder', 'POST', payload, submitStoreKey);
        }
        if (res?.code === 0) {
            addLog(`下单成功: 销售单号 ${payload.shopOrderNumber}，建行单号 ${res.data}`, "info");
            showSnackbar({ message: "订单提交成功！" });
            if (res.data) {
                const orderContext = {
                    ...submitStoreContext,
                    ccbPayOrderNumber: res.data,
                    shopOrderNumber: payload.shopOrderNumber,
                    storeOrderNumber: payload.shopOrderNumber
                };
                openQrDialog(orderContext);

                enqueueOrder(submitStoreKey, res.data, {
                    ...submitStoreContext,
                    storeNameSnapshot: submitStoreContext.storeName,
                    lastState: 0,
                    buyerMobile: mobile,
                    createdAt: Date.now(),
                    lastCheckAt: 0
                });

                checkNowAndEnsurePolling("submitOrder");
            }

        } else if (res === null || res === undefined) {
            // 超时/网络中断：服务端可能已建单，重复提交会产生两张订单
            addLog(`提交订单无响应（可能超时），单号 ${payload.shopOrderNumber}`, "error");
            showError(`提交无响应，服务端可能已受理。请先到订单列表按单号 ${payload.shopOrderNumber} 确认，再决定是否重新提交`);
        } else {
            addLog(`提交订单失败: ${res?.msg}`, "error");
            showError(res?.msg || "提交失败");
        }
        } catch (error) {
            addLog(`提交订单失败: ${error.message}`, "error");
            showError(error.message || "提交失败");
        } finally {
            state.isSubmittingOrder = false;
            submitButton.disabled = false;
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
            setFieldValueAnimated('#buyerMobile', mobile);
            checkQualification();
        }

        if (name && /^[\u4e00-\u9fa5]{2,4}$/.test(name)) {
            setFieldValueAnimated('#buyerName', name);
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
            setFieldValueAnimated('#detailAddress', detail);
        }

        if (goodsCode && /^69\d{8,}$/.test(goodsCode)) {
            setFieldValueAnimated('#goodsCode', goodsCode);
            if (state.currentToken) {
                setTimeout(() => queryGoodsInfo(), 100);
            }
        }

        schedulePreviewRender();
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
            setFieldValueAnimated('#buyerMobile', mobile);
            checkQualification();
        }

        let goodsCode = "";
        const goodsCodeMatch = raw.match(/69\d{8,}/);
        if (goodsCodeMatch) {
            goodsCode = goodsCodeMatch[0];
            setFieldValueAnimated('#goodsCode', goodsCode);
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
                setFieldValueAnimated('#buyerName', buyerName);
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

        setFieldValueAnimated('#detailAddress', addr);
        schedulePreviewRender();
    }

    // ==================== passGoodsList API 商品库 ====================
    const PASS_GOODS_CACHE_DB = 'PassGoodsCache';
    const PASS_GOODS_CACHE_STORE = 'data';

    function openPassGoodsCacheDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(PASS_GOODS_CACHE_DB, 1);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(PASS_GOODS_CACHE_STORE, { keyPath: 'uniscid' });
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function loadPassGoodsCache(goodsUniscid) {
        try {
            const db = await openPassGoodsCacheDB();
            const tx = db.transaction(PASS_GOODS_CACHE_STORE, 'readonly');
            const result = await new Promise((resolve, reject) => {
                const req = tx.objectStore(PASS_GOODS_CACHE_STORE).get(goodsUniscid);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            db.close();
            return result || null;
        } catch (e) {
            return null;
        }
    }

    async function savePassGoodsCache(goodsUniscid, data, totalCount) {
        try {
            const db = await openPassGoodsCacheDB();
            const tx = db.transaction(PASS_GOODS_CACHE_STORE, 'readwrite');
            tx.objectStore(PASS_GOODS_CACHE_STORE).put({
                uniscid: goodsUniscid,
                data,
                totalCount,
                timestamp: Date.now()
            });
            await new Promise(resolve => { tx.oncomplete = resolve; });
            db.close();
        } catch (e) {
            addLog('缓存商品库失败: ' + e.message, 'warn');
        }
    }

    async function fetchPassGoodsList(goodsUniscid, storeKey, onProgress) {
        if (!goodsUniscid) {
            addLog('fetchPassGoodsList: goodsUniscid 为空', 'warn');
            return null;
        }

        addLog(`开始拉取商品库 [${goodsUniscid}]...`, 'info');
        if (onProgress) onProgress('正在查询商品总数...');

        const countRes = await callApi('/approval/passGoodsList', 'POST', {
            goodsUniscid,
            pageSize: 1,
            pageNum: 1
        }, storeKey);

        if (!countRes || countRes.code !== 0) {
            addLog(`查询商品总数失败: ${countRes?.msg || '未知错误'}`, 'error');
            return null;
        }

        const totalCount = countRes.count || 0;
        addLog(`商品库共 ${totalCount} 条记录`, 'info');

        if (totalCount === 0) {
            return { data: [], totalCount: 0 };
        }

        if (onProgress) onProgress(`正在拉取 ${totalCount} 条商品数据...`);

        const dataRes = await callApi('/approval/passGoodsList', 'POST', {
            goodsUniscid,
            pageSize: totalCount,
            pageNum: 1
        }, storeKey);

        if (!dataRes || dataRes.code !== 0) {
            addLog(`拉取商品库失败: ${dataRes?.msg || '未知错误'}`, 'error');
            return null;
        }

        const items = dataRes.data || [];
        addLog(`商品库拉取完成: ${items.length} 条`, 'info');

        await savePassGoodsCache(goodsUniscid, items, totalCount);

        return { data: items, totalCount };
    }

    // ==================== 商品 Excel 搜索模块 ====================
    const ProductSearch = (() => {
        let allSheetData = {};
        let allSheetHeaders = {};
        let sheetNames = [];
        let currentSheet = "";
        let fuseInstance = null;
        let currentItems = [];
        let libsLoaded = false;
        let currentFileName = "";
        let loadedContextKey = "";
        let dataLoaded = false;
        let poolDownloaded = false;

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
            _libsLoading = loadScript('https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js').then(() => {
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

        function showParsed(fileName) {
            currentFileName = fileName;
            dataLoaded = true;
            $('psBottomBar').style.display = 'flex';
            $('psFileName').textContent = fileName;
            $('psSearchBar').style.display = '';
            $('psResultsList').style.display = '';
            $('psCachedBadge').style.display = poolDownloaded ? '' : 'none';

            if (sheetNames.length > 0) {
                selectSheet(sheetNames[0]);
            }
        }

        function selectSheet(name) {
            currentSheet = name;
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
                const typeField = findField(item, ['商品类型', 'goodsType']);
                const priceField = findField(item, ['备案价', '价格', 'filingPrice', 'tradePriceMonth3', 'subsidyBackPrice']);
                const isDisabled = String(item.isHandle) === '0';

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
                row.className = 'ps-result-row' + (isDisabled ? ' ps-result-disabled' : '');
                row.innerHTML =
                    '<div class="ps-result-left">' +
                        '<span class="ps-result-name">' + nameHtml + (isDisabled ? ' <span class="ps-disabled-tag">不可用</span>' : '') + '</span>' +
                        '<span class="ps-result-meta">' +
                            '<span>' + codeHtml + '</span>' +
                            (typeField ? '<span>' + escapeHtml(typeField) + '</span>' : '') +
                        '</span>' +
                    '</div>' +
                    scoreHtml +
                    '<span class="ps-result-price">¥' + escapeHtml(priceField || '-') + '</span>';
                if (!isDisabled) {
                    row.addEventListener('click', () => importProduct(item));
                }
                list.appendChild(row);
            });
            if (items.length > maxShow) {
                const hint = document.createElement('div');
                hint.style.cssText = 'padding:8px;text-align:center;font-size:12px;color:rgb(var(--mdui-color-outline));';
                hint.textContent = '仅显示前 ' + maxShow + ' 条，请缩小搜索范围';
                list.appendChild(hint);
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

            const storeKey = getCurrentStoreKey();
            const uiGeneration = state.currentUiGeneration;
            const goodsUniscid = state.currentGoodsUniscid;
            const contextKey = `${storeKey}|${goodsUniscid}`;
            if (dataLoaded && sheetNames.length > 0 && loadedContextKey === contextKey) {
                showParsed(currentFileName);
                return;
            }

            if (!goodsUniscid) {
                $('psResultsList').innerHTML = '<div style="padding:40px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="info" style="font-size:36px;opacity:0.3;display:block;margin:0 auto 6px;"></mdui-icon>未获取到 goodsUniscid，请先登录</div>';
                $('psSearchBar').style.display = 'none';
                $('psSearchStatus').style.display = 'none';
                $('psBottomBar').style.display = 'none';
                return;
            }

            $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>正在加载商品库...</span></div>';
            $('psSearchBar').style.display = 'none';
            $('psSearchStatus').style.display = 'none';
            $('psBottomBar').style.display = 'none';

            const cached = await loadPassGoodsCache(goodsUniscid);
            if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;
            if (cached && cached.data && cached.data.length > 0) {
                const age = Date.now() - (cached.timestamp || 0);
                const hours = Math.floor(age / 3600000);
                if (age > CONSTANTS.PASS_GOODS_CACHE_TTL_MS) {
                    addLog(`商品库缓存已过期 (${hours}小时前)，开始刷新...`, 'info');
                } else {
                    addLog(`使用缓存商品库: ${cached.data.length} 条 (${hours}小时前更新)`, 'info');
                    localStorage.setItem(CONSTANTS.PASS_GOODS_COUNT_KEY, String(cached.data.length));
                    loadApiDataIntoSearch(cached.data, goodsUniscid, contextKey);
                    return;
                }
            }

            const result = await fetchPassGoodsList(goodsUniscid, storeKey, (msg) => {
                if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;
                $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>' + escapeHtml(msg) + '</span></div>';
            });
            if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;

            if (result && result.data && result.data.length > 0) {
                localStorage.setItem(CONSTANTS.PASS_GOODS_COUNT_KEY, String(result.data.length));
                loadApiDataIntoSearch(result.data, goodsUniscid, contextKey);
            } else {
                $('psResultsList').innerHTML = '<div style="padding:40px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="inventory_2" style="font-size:36px;opacity:0.3;display:block;margin:0 auto 6px;"></mdui-icon>商品库为空或拉取失败</div>';
            }
        }

        function loadApiDataIntoSearch(items, displayName, contextKey) {
            const sheetName = '商品库';
            allSheetData = { [sheetName]: items };
            allSheetHeaders = { [sheetName]: Object.keys(items[0] || {}) };
            sheetNames = [sheetName];
            currentFileName = displayName || '商品库';
            loadedContextKey = contextKey || "";
            poolDownloaded = true;
            showParsed(displayName || '商品库');
        }

        async function refreshGoodsPool() {
            const storeKey = getCurrentStoreKey();
            const uiGeneration = state.currentUiGeneration;
            const goodsUniscid = state.currentGoodsUniscid;
            const contextKey = `${storeKey}|${goodsUniscid}`;
            if (!goodsUniscid) {
                return showSnackbar({ message: '未获取到 goodsUniscid，请先登录' });
            }

            addLog(`强制刷新商品库 [${goodsUniscid}]...`, 'info');
            showSnackbar({ message: '正在刷新商品库...' });

            const lastCount = parseInt(localStorage.getItem(CONSTANTS.PASS_GOODS_COUNT_KEY) || '0', 10);

            dataLoaded = false;
            poolDownloaded = false;
            sheetNames = [];
            allSheetData = {};
            allSheetHeaders = {};
            currentItems = [];
            fuseInstance = null;

            $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>正在刷新商品库...</span></div>';
            $('psSearchBar').style.display = 'none';
            $('psSearchStatus').style.display = 'none';
            $('psBottomBar').style.display = 'none';
            $('psResultsList').style.display = '';

            const result = await fetchPassGoodsList(goodsUniscid, storeKey, (msg) => {
                if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;
                $('psResultsList').innerHTML = '<div class="ps-loading-box"><mdui-circular-progress style="width:24px;height:24px;"></mdui-circular-progress><span>' + escapeHtml(msg) + '</span></div>';
            });
            if (uiGeneration !== state.currentUiGeneration || storeKey !== getCurrentStoreKey()) return;

            if (result && result.data && result.data.length > 0) {
                const newCount = result.data.length;
                localStorage.setItem(CONSTANTS.PASS_GOODS_COUNT_KEY, String(newCount));
                loadApiDataIntoSearch(result.data, goodsUniscid, contextKey);
                if (lastCount > 0 && newCount > lastCount) {
                    const added = newCount - lastCount;
                    addLog(`商品库更新: ${lastCount} -> ${newCount} (+${added})`, 'info');
                    showSnackbar({ message: `商品库已更新: 新增 ${added} 条商品 (${newCount} 条)` });
                } else {
                    showSnackbar({ message: `商品库已刷新: ${newCount} 条` });
                }
            } else {
                showSnackbar({ message: '商品库刷新失败' });
                $('psResultsList').innerHTML = '<div style="padding:40px;text-align:center;color:rgb(var(--mdui-color-outline));"><mdui-icon name="inventory_2" style="font-size:36px;opacity:0.3;display:block;margin:0 auto 6px;"></mdui-icon>商品库为空或拉取失败</div>';
            }
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
            currentFileName = '';
            loadedContextKey = '';
        }

        function init() {
            $('psCloseBtn').addEventListener('click', () => { $('productSearchDialog').open = false; });

            $('psChangeFileBtn').addEventListener('click', () => {
                refreshGoodsPool();
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
        }

        return { open, init, resetCache, refreshGoodsPool };
    })();

    function bindEventListeners() {
        const formContainer = document.querySelector('.container');
        formContainer?.addEventListener('input', schedulePreviewRender, true);
        formContainer?.addEventListener('change', schedulePreviewRender, true);

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
        document.getElementById('closeExportConfigBtn').addEventListener('click', () => {
            const dialog = document.getElementById('exportConfigDialog');
            const output = document.getElementById('exportConfigRawOutput');
            dialog.open = false;
            if (output) output.value = "";
        });
        document.getElementById('testDingTalkBtn').addEventListener('click', testDingTalk);

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
            // 换号后必须清掉上一位买家的资格，否则屏幕上还是旧结果
            resetQualificationChips();
        });
        document.getElementById('chipExpandBtn').addEventListener('click', toggleChipExpand);
        // mdui-switch 不是原生可标注控件，label 不会自动联动，这里手动转发点击
        document.querySelectorAll('.switch-row').forEach(row => {
            row.addEventListener('click', (e) => {
                const sw = row.querySelector('mdui-switch');
                if (!sw || e.target === sw || sw.contains(e.target)) return;
                sw.checked = !sw.checked;
                sw.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
        document.getElementById('autoOrderNumCheckbox').addEventListener('change', () => toggleOrderInput());
        document.getElementById('goodsCode').addEventListener('blur', queryGoodsInfo);
        document.getElementById('shopPrice').addEventListener('change', calcPrice);
        // 输入过程中就给出超备案价的红框提示，不等失焦
        document.getElementById('shopPrice').addEventListener('input', validateShopPriceAgainstFiling);
        document.getElementById('actualPrice').addEventListener('change', reverseCalcPrice);
        document.getElementById('submitOrderBtn').addEventListener('click', submitOrder);
        document.getElementById('saveDraftFabBtn').addEventListener('click', saveCurrentAsDraft);
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
                return;
            }

            const removeBtn = e.target.closest('.remove-payload-btn');
            if (removeBtn) {
                if (!removeBtn.disabled) {
                    const index = parseInt(removeBtn.dataset.index, 10);
                    removePayloadEntry(index);
                }
                return;
            }

            const radio = e.target.closest('mdui-radio');
            if (radio && radio.value !== undefined) {
                setConfigDraftCurrentIndex(parseInt(radio.value, 10));
                return;
            }

            const head = e.target.closest('.store-item-head');
            if (head && head.dataset.storeIndex !== undefined) {
                setConfigDraftCurrentIndex(parseInt(head.dataset.storeIndex, 10));
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
                const storeKey = openQrBtn.dataset.storeKey || orderCard?.dataset.storeKey || "";
                openQrDialog(findOrderContext(storeKey, orderNumber));
            } else if (viewDetailBtn) {
                e.stopPropagation();
                const orderNumber = viewDetailBtn.dataset.orderNumber;
                const storeKey = viewDetailBtn.dataset.storeKey || orderCard?.dataset.storeKey || "";
                viewOrderDetail(orderNumber, storeKey);
            } else if (orderCard) {
                const orderNumber = orderCard.dataset.orderNumber;
                viewOrderDetail(orderNumber, orderCard.dataset.storeKey || "");
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
                    updateDraftBadge();
                    showSnackbar({ message: "已清空所有暂存" });
                }
            });
        });
    }

    /** 兜底捕获未处理的异步异常，避免出现“按钮点了没反应也没日志”的情况 */
    function bindGlobalErrorHandlers() {
        window.addEventListener('unhandledrejection', (e) => {
            const reason = e?.reason;
            const msg = reason?.message || String(reason || '未知错误');
            addLog(`未处理的异步异常: ${msg}`, "error");
            console.error('[unhandledrejection]', reason);
        });
        window.addEventListener('error', (e) => {
            if (!e?.message) return;
            addLog(`脚本异常: ${e.message} @ ${e.filename || ''}:${e.lineno || 0}`, "error");
        });
    }

    function init() {
        bindGlobalErrorHandlers();
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

        if (state.storePayloads.length && state.storePayloads[state.currentStoreIndex]?.payload?.trim()) {
            state.loginPayload = state.storePayloads[state.currentStoreIndex].payload.trim();
            autoLogin();
        } else {
            openConfigDialog();
            showSnackbar({ message: "请先配置至少一个门店 Payload" });
        }

        renderShopSwitchMenu();
        bindEventListeners();
        toggleOrderInput();
        ProductSearch.init();
        updateDraftBadge();
        updateQueueBadge();
        renderOrderPreview();

        if (hasQueuedOrders()) {
            addLog(`启动自动检查，待检订单数: ${getAllQueuedOrders().length}`, "info");
            checkNowAndEnsurePolling("boot");
        }
    }

    window.addEventListener('load', init);
})();
