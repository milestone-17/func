#!/usr/bin/env python3
"""
本地财务 PWA 端到端测试 (自包含: 自动起 preview 服务 → 跑测试 → 收尾)

用法:
  1. 先构建: npm run build
  2. 跑 E2E: python3 tests/e2e/app.py

依赖: playwright + chromium
  pip install playwright && python -m playwright install chromium
"""
import sys, os, time, signal, subprocess, urllib.request, traceback, re, json, math
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173/func/"
PORT = 4173
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/func-e2e-shots/")

# ---------------------------------------------------------------------------
# 脱敏真实备份 fixture → 东财基金批量 JSONP 的真实净值 (16 只全部按备份净值回填)
# ---------------------------------------------------------------------------
FIXTURE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            '..', 'fixtures', 'backup-holdings-20260813.json')
with open(FIXTURE_PATH, encoding='utf-8') as _f:
    _FIX = json.load(_f)
FUNDS = _FIX['holdings']  # 16 只持仓, 含 navYuan (东财实测单位净值 元)
FUND_NAV_FIXTURES = [(h['symbol'], h['name'], str(h['navYuan'])) for h in FUNDS]

# 跨境/QDII 关键词 (与 src/lib/settlement.ts QDII_RE 对齐)
_QDII_RE = re.compile(r'纳斯达克|纳指|标普|恒生|中概|海外|全球|美国|日本|日经|德国|印度|越南|原油|qdii|港股', re.I)


def _mock_fund_navs(route):
    """东财移动端基金批量接口 → 用请求里的 callback 名回 JSONP (绕 CORS 后脚本注入)"""
    m = re.search(r"callback=([^&]+)", route.request.url)
    cb = m.group(1) if m else "jsonp"
    datas = ",".join(
        '{"FCODE":"%s","SHORTNAME":"%s","PDATE":"2026-08-12","NAV":"%s","GSZ":null}'
        % (c, n, v)
        for c, n, v in FUND_NAV_FIXTURES
    )
    body = f"{cb}({{\"Datas\":[{datas}],\"ErrCode\":0,\"Success\":true}});"
    route.fulfill(status=200, content_type="application/javascript", body=body)


def _mock_push2(route):
    """东财 push2 单票现价接口 (fetchHoldingPrice 对批量接口未命中的 6 位代码的回落源)。

    转换新建的基金 (如 008888) 不在 16 只 fixture 批量数据里 → 触发此回落请求。
    CI 网络可达该服务器但被 CORS 拦截, 报错文案与本地网络层 `Failed to fetch`
    不同, 会被「非预期错误」护栏误判为失败; 本地环境同样产生真实外呼。统一 mock:
    返回固定 2.00 元, 与转换抽屉手动录入净值一致, e2e 完全封闭无外呼。"""
    route.fulfill(status=200, content_type="application/json",
                  body='{"data":{"f43":200},"rc":0,"rt":1,"code":0}')


def _yuan_to_fen(y):
    """复刻 src/lib/money.ts yuanToFen 的字符串进位逻辑 (1.7811 → 178)"""
    s = repr(abs(y))
    if '.' in s:
        int_str, dec = s.split('.', 1)
    else:
        int_str, dec = s, ''
    c1 = int(dec[0]) if len(dec) > 0 else 0
    c2 = int(dec[1]) if len(dec) > 1 else 0
    c3 = int(dec[2]) if len(dec) > 2 else 0
    cents = c1 * 10 + c2 + (1 if c3 >= 5 else 0)
    extra = 0
    if cents >= 100:
        cents -= 100
        extra = 1
    sign = -1 if y < 0 else 1
    return sign * (int(int_str) * 100 + cents + extra * 100)


def _build_fixture_bundle():
    """把脱敏持仓 fixture 组装成合法 BackupBundle (schemaVersion 1), 镜像真实备份结构:
    - holdings: currentPrice/category 均缺省 → 导入后 refresh 自动分类 + 自动拉价
    - holdingTxns: 每只 1 条 buy (2026-08-12, 净值=均价) — 存量已结算
    - permanentTargets: 25/25/25/25; dcaConfigs 留空 (由 UI 新建配置测 2.6)"""
    now = 1786549856158
    holdings, txns = [], []
    for i, h in enumerate(FUNDS):
        hid = f"fx-{h['symbol']}-hold"
        holdings.append({
            "id": hid, "symbol": h["symbol"], "name": h["name"],
            "market": h["market"], "currency": h["currency"], "type": h["type"],
            "quantity": h["quantity"], "avgCost": h["avgCost"],
            "currentPrice": None, "currentPriceAt": None,
            "createdAt": now + i, "updatedAt": now + i, "deletedAt": None,
        })
        txns.append({
            "id": f"fx-{h['symbol']}-txn", "holdingId": hid, "side": "buy",
            "date": "2026-08-12", "price": h["avgCost"], "quantity": h["quantity"],
            "fee": 0, "createdAt": now + 1000 + i, "updatedAt": now + 1000 + i, "deletedAt": None,
        })
    perm = [{"id": f"fx-tgt-{t}", "assetType": t, "targetPercent": 25,
             "createdAt": now, "updatedAt": now, "deletedAt": None}
            for t in ("stock", "bond", "cash", "gold")]
    settings = {"id": "app", "theme": "system", "baseCurrency": "CNY", "usdCnyRate": 7.2,
                "rateUpdatedAt": now, "permanentThreshold": 5, "lastIndexSync": {},
                "schemaVersion": 1, "passHash": None, "passSalt": None, "lastBackupAt": None,
                "backupReminderDays": 30, "backupReminderSnoozedAt": None,
                "storagePersisted": False, "updatedAt": now}
    return {
        "schemaVersion": 1, "exportedAt": "2026-08-13T01:07:43.243Z",
        "data": {
            "transactions": [], "categories": [], "budgets": [],
            "holdings": holdings, "holdingTxns": txns,
            "permanentTargets": perm, "dcaConfigs": [], "indexData": [], "dcaExecutions": [],
            "dailyDcaConfigs": [], "settings": [settings], "meta": [],
        },
    }


BUNDLE_BYTES = json.dumps(_build_fixture_bundle(), ensure_ascii=False).encode('utf-8')


def wait_for(url, timeout=40):
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def run_tests():
    os.makedirs(SHOTS, exist_ok=True)
    console_errors, page_errors, results = [], [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        # 拦截东财基金批量接口 → 返回固定 JSONP, 使净值回填确定性可测
        page.route("**/FundMNFInfo*", _mock_fund_navs)
        # 拦截东财 push2 单票现价接口 (批量未命中的 6 位代码回落源), 避免真实外呼/CORS 误报
        page.route("**/api/qt/stock/get*", _mock_push2)

        def ok(name, cond, detail=""):
            results.append((name, bool(cond), detail))
            print(f"  [{'✓' if cond else '✗'}] {name}" + (f" — {detail}" if detail and not cond else ""))

        def section(title, fn):
            print(f"→ {title}")
            try:
                fn()
            except Exception as e:
                results.append((title, False, repr(e)[:160]))
                print(f"  ✗ {title} 异常: {repr(e)[:160]}")
                traceback.print_exc()

        def shot(n):
            page.screenshot(path=os.path.join(SHOTS, n), full_page=True)

        def backdate_open_txns(days: int = 3):
            """把「今天日期」的首笔买入交易回填为 days 天前 → 使其按 T+1 已结算。

            表单新建持仓的首笔买入以 new Date() 记为今天 (T+1 确认中), 数量为 0;
            真实使用中持仓早已建仓、首笔交易已确认。此步让 s_trading 在已结算的
            持仓上交易, 与真实备份数据形态一致。"""
            today_utc = datetime.utcnow().strftime('%Y-%m-%d')
            target = (datetime.utcnow() - timedelta(days=days)).strftime('%Y-%m-%d')
            page.evaluate("""([today, target]) => new Promise((resolve, reject) => {
              const req = indexedDB.open('func-db')
              req.onsuccess = () => {
                const db = req.result
                const tx = db.transaction('holdingTxns', 'readwrite')
                const store = tx.objectStore('holdingTxns')
                const all = store.getAll()
                all.onsuccess = () => {
                  for (const t of all.result) {
                    if (t.side === 'buy' && t.date === today) { t.date = target; store.put(t) }
                  }
                  resolve()
                }
                all.onerror = () => reject(all.error)
              }
              req.onerror = () => reject(req.error)
            })""", [today_utc, target])
            page.reload()
            page.wait_for_timeout(600)

        def s_load():
            page.goto(BASE, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(1000)
            shot("01-dashboard.png")
            ok("应用加载", page.locator("text=本地财务").count() > 0)
            ok("总览-净资产区", page.locator("text=投资净资产").count() > 0)
        section("加载+总览", s_load)

        def s_ledger():
            page.locator("a:has-text('账本')").first.click()
            page.wait_for_timeout(500)
            page.locator("button:has-text('记一笔')").click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".amount-input input").first.fill("88.5")
            if page.locator("button:has-text('餐饮')").count() > 0:
                page.locator("button:has-text('餐饮')").first.click()
            page.locator(".sheet-panel button:has-text('保存')").click()
            page.wait_for_timeout(700)
            shot("02-ledger.png")
            ok("账本-记账后有条目", page.locator("text=/88\\.50|¥88/").count() > 0)
        section("账本(记账)", s_ledger)

        def s_budget():
            page.locator("a:has-text('预算')").first.click()
            page.wait_for_timeout(500)
            page.locator("input[type='number']").first.fill("5000")
            page.locator("button:has-text('保存')").click()
            page.wait_for_timeout(700)
            shot("03-budget.png")
            ok("预算-周分扣生成", page.locator("text=第 1 周").count() > 0)
        section("预算(保存分配)", s_budget)

        def s_portfolio():
            page.locator("a:has-text('投资')").first.click()
            page.wait_for_timeout(500)
            page.locator("button:has-text('新增')").click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".sheet-panel input[placeholder*='QQQ']").fill("AAPL")
            page.locator(".sheet-panel input[placeholder*='ETF']").fill("苹果")
            # 选择分类: 纳斯达克100 (表单第 2 个 select)
            page.locator(".sheet-panel select").nth(1).select_option(label="纳斯达克100")
            page.locator(".sheet-panel .amount-input input").fill("200")
            page.locator(".sheet-panel input[placeholder='0']").fill("10")
            page.locator(".sheet-panel button:has-text('保存')").click()
            page.wait_for_timeout(900)
            shot("04-portfolio.png")
            ok("投资-建仓后显示", page.locator("text=苹果").count() > 0)
            # 分类筛选
            page.locator("button:has-text('纳斯达克100')").first.click()
            page.wait_for_timeout(400)
            ok("投资-纳斯达克100分类可见", page.locator("text=苹果").count() > 0)
            page.locator("button:has-text('标普500')").first.click()
            page.wait_for_timeout(400)
            ok("投资-标普500分类下隐藏苹果", page.locator("text=苹果").count() == 0)
            # 全部 需锚定: header 的「拉取全部」也含"全部", 仅匹配分类筛选按钮 (文本以"全部"开头+计数)
            page.locator("button", has_text=re.compile(r"^全部")).first.click()
            page.wait_for_timeout(300)
            ok("投资-一键自动分类按钮", page.locator("button:has-text('一键自动分类')").count() > 0)
            # 中国场外基金 (6 位代码): 分类自动预填 → 保存 → 批量拉取回填净值
            page.locator("button:has-text('新增')").click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".sheet-panel input[placeholder*='QQQ']").fill("006260")
            page.locator(".sheet-panel input[placeholder*='ETF']").fill("汇添富红利增长混合C")
            page.wait_for_timeout(300)  # 等名称/代码 watch 自动预填分类
            ok("投资-基金分类自动预填红利", page.locator(".sheet-panel select").nth(1).input_value() == "dividend")
            page.locator(".sheet-panel .amount-input input").fill("1.78")
            page.locator(".sheet-panel input[placeholder='0']").fill("100")
            page.locator(".sheet-panel button:has-text('保存')").click()
            page.wait_for_timeout(900)
            fund_card = page.locator("div.card", has_text="汇添富红利")
            ok("投资-基金持仓显示", fund_card.count() > 0)
            ok("投资-基金自动分类红利标签", fund_card.locator("span", has_text="红利").count() > 0)
            page.locator("button:has-text('拉取全部')").click()
            # 两段式: 基金批量先回填, 美股回落(最多~4s)后出汇总提示 → 轮询等「已更新」
            price_cell = fund_card.locator("div.bg-surface2 .money").nth(2)
            deadline = time.time() + 15
            while time.time() < deadline and page.locator("text=/已更新/").count() == 0:
                page.wait_for_timeout(300)
            ok("投资-基金净值批量回填(1.78)", price_cell.inner_text() == "1.78")
            ok("投资-批量拉取提示", page.locator("text=/已更新/").count() > 0)
            # 回填首笔买入日期 → 已结算 (s_trading 需在已确认持仓上交易)
            backdate_open_txns()
        section("投资(建仓+分类)", s_portfolio)

        def s_trading():
            # 进入投资页 (用现有"汇添富红利"基金卡验证加仓/减仓/转换/详情/已清仓)
            page.locator("a:has-text('投资')").first.click()
            page.wait_for_timeout(500)
            fund_card = page.locator("div.card", has_text="汇添富红利").first
            # ---- 1. 详情页打开 ----
            fund_card.locator("button:has-text('汇添富红利')").first.click()
            page.wait_for_url(re.compile(r"/holding/"), timeout=5000)
            page.wait_for_timeout(400)
            ok("详情-顶部名称", page.locator("h2", has_text="汇添富红利").count() > 0)
            ok("详情-基金代码", page.locator("text=006260").count() > 0)
            ok("详情-T+1 标记", page.locator("text=T+1").count() > 0)
            ok("详情-净值走势标题", page.locator("text=净值走势").count() > 0)
            ok("详情-交易记录区", page.locator("text=/交易记录/").count() > 0)
            shot("09-detail.png")

            # ---- 2. 详情页底部操作栏 → 加仓 ----
            page.locator("nav.fixed button", has_text="加仓").first.click()
            page.wait_for_url(re.compile(r"action=add"), timeout=5000)
            page.wait_for_timeout(400)
            # 自动打开投资页加仓抽屉
            ok("加仓-抽屉打开", page.locator(".sheet-panel h3", has_text="加仓").count() > 0)
            ok("加仓-结算 T+1 显示", page.locator(".sheet-panel", has_text="T+1").count() > 0)
            # 按金额 100 元
            inputs = page.locator(".sheet-panel input[type='number']")
            inputs.first.fill("100")
            page.wait_for_timeout(200)
            ok("加仓-预计份额预览", page.locator(".sheet-panel .bg-surface2 .money", has_text=re.compile(r"^\d")).count() > 0)
            page.locator(".sheet-panel button:has-text('确认')").click()
            page.wait_for_timeout(700)
            # 加仓后回到投资页, 持有份数应变化; 卡片里的"持有 X 份"刷新
            ok("加仓-提交后无残留抽屉", page.locator(".sheet-panel").count() == 0)

            # ---- 3. 减仓 (按金额 50) ----
            # 通过详情页跳回带 query 的方式打开, 与生产路径一致
            page.locator("div.card", has_text="汇添富红利").first.locator("button:has-text('汇添富红利')").first.click()
            page.wait_for_url(re.compile(r"/holding/"), timeout=5000)
            page.wait_for_timeout(800)  # 等 onMounted → refresh 完成
            page.locator("nav.fixed button", has_text="减仓").first.click()
            page.wait_for_url(re.compile(r"action=reduce"), timeout=5000)
            page.wait_for_timeout(400)
            ok("减仓-抽屉打开", page.locator(".sheet-panel h3", has_text="减仓").count() > 0)
            # 默认按金额, 卖出 50 元
            page.locator(".sheet-panel input[type='number']").first.fill("50")
            page.wait_for_timeout(150)
            page.locator(".sheet-panel button:has-text('确认')").click()
            page.wait_for_timeout(700)
            if page.locator(".sheet-panel").count() != 0:
                shot("reduce-error.png")
                err = page.locator(".sheet-panel .text-neg").first.inner_text() if page.locator(".sheet-panel .text-neg").count() > 0 else "(no error msg)"
                ok("减仓-提交完成", False, f"抽屉未关闭, 错误: {err}")
            else:
                ok("减仓-提交完成", True)

            # ---- 4. 加仓第二次 (验证多次加仓不冲突) ----
            page.locator("div.card", has_text="汇添富红利").first.locator("button:has-text('汇添富红利')").first.click()
            page.wait_for_url(re.compile(r"/holding/"), timeout=5000)
            page.wait_for_timeout(400)
            page.locator("nav.fixed button", has_text="加仓").first.click()
            page.wait_for_url(re.compile(r"action=add"), timeout=5000)
            page.wait_for_timeout(400)
            page.locator(".sheet-panel input[type='number']").first.fill("30")
            page.wait_for_timeout(150)
            page.locator(".sheet-panel button:has-text('确认')").click()
            page.wait_for_timeout(700)
            ok("加仓-二次提交完成", page.locator(".sheet-panel").count() == 0)

            # ---- 5. 转换: 卖出「苹果」(AAPL) 全部 → 转入新基金 006479 ----
            apple_card = page.locator("div.card", has_text="苹果").first
            apple_card.locator("button:has-text('⇄ 转换')").first.click()
            page.wait_for_timeout(400)
            ok("转换-抽屉打开", page.locator(".sheet-panel h3", has_text="转换").count() > 0)
            # 默认 mode=all
            page.locator(".sheet-panel input[placeholder*='006260']").fill("006479")
            page.locator(".sheet-panel input[placeholder*='易方达']").fill("易方达中证500联接A")
            page.locator(".sheet-panel input[placeholder*='0.0000']").fill("1.50")
            page.wait_for_timeout(300)
            ok("转换-转出金额预览", page.locator(".sheet-panel .bg-surface2 .money").count() >= 2)
            page.locator(".sheet-panel button:has-text('确认转换')").click()
            page.wait_for_timeout(800)
            ok("转换-完成后抽屉关闭", page.locator(".sheet-panel").count() == 0)
            # 自动建仓 → 卡片应出现
            new_card = page.locator("div.card", has_text="易方达中证500")
            ok("转换-新基金自动建仓", new_card.count() > 0)
            shot("10-after-convert.png")

            # ---- 6. 详情页可打开新基金 (验证路由 + 走势空态/数据) ----
            new_card.first.locator("button:has-text('易方达中证500')").first.click()
            page.wait_for_url(re.compile(r"/holding/"), timeout=5000)
            page.wait_for_timeout(300)
            ok("详情-新基金页可访问", page.locator("h2", has_text="易方达中证500").count() > 0)
        section("交易(加仓/减仓/转换/详情)", s_trading)

        def s_dca():
            page.locator("a:has-text('定投')").first.click()
            page.wait_for_timeout(600)
            if page.locator("button:has-text('立即配置')").count() > 0:
                page.locator("button:has-text('立即配置')").click()
                page.wait_for_selector(".sheet-panel", timeout=5000)
                page.locator(".sheet-panel input[placeholder='0.00']").fill("2000")
                page.locator(".sheet-panel button:has-text('保存')").click()
                page.wait_for_timeout(1000)
            shot("05-dca.png")
            ok("定投-标普500标的可选", page.locator("button:has-text('标普500')").count() > 0)
            ok("定投-MA250年线", page.locator("text=MA250").count() > 0)
            ok("定投-MA120半年线", page.locator("text=MA120").count() > 0)
            ok("定投-MA180", page.locator("text=MA180").count() > 0)
            ok("定投-偏离档位表", page.locator("text=偏离档位表").count() > 0)
            ok("定投-4周建议", page.locator("text=/建议投入|按建议投入/").count() > 0)
            ok("定投-图表canvas", page.locator("canvas").count() > 0)
            ok("定投-每日定投卡", page.locator("text=每日定投").count() > 0)
        section("定投(NDX+SPX+三均线+建议+每日)", s_dca)

        def s_perm():
            page.locator("a:has-text('永久')").first.click()
            page.wait_for_timeout(500)
            shot("06-permanent.png")
            ok("永久-四类资产", page.locator("text=股票").count() > 0 and page.locator("text=黄金").count() > 0)
            ok("永久-组合总市值", page.locator("text=组合总市值").count() > 0)
            total_text = page.locator("div.money.text-3xl").first.inner_text()
            ok("永久-组合总市值非零(基金持仓计价)", total_text not in ("¥0.00", "¥0"), f"总市值={total_text}")
        section("永久组合", s_perm)

        def s_settings():
            page.locator("a[aria-label='设置']").first.click()
            page.wait_for_timeout(500)
            shot("07-settings.png")
            page.locator("button:has-text('深色')").click()
            page.wait_for_timeout(400)
            is_dark = page.evaluate("() => document.documentElement.classList.contains('dark')")
            ok("设置-深色主题生效", is_dark)
            page.locator("button:has-text('浅色')").click()
            page.wait_for_timeout(300)
            ok("设置-应用锁区块", page.locator("text=应用锁").count() > 0)
            ok("设置-持久化状态显示", page.locator("text=持久化存储").count() > 0)
            ok("设置-最近备份显示", page.locator("text=最近备份").count() > 0)
            ok("设置-备份提醒阈值", page.locator("text=备份提醒阈值").count() > 0)
            if page.locator("button:has-text('开启应用锁')").count() > 0:
                page.locator("button:has-text('开启应用锁')").click()
                page.wait_for_timeout(400)
                tels = page.locator("input[type='tel']")
                tels.nth(0).fill("123456"); tels.nth(1).fill("123456")
                page.locator("button:has-text('确认开启')").click()
                page.wait_for_timeout(500)
                ok("应用锁-开启", page.locator("text=已开启").count() > 0)
                page.locator("button:has-text('关闭应用锁')").click()
                page.wait_for_timeout(300)
                page.locator("input[type='tel']").fill("123456")
                page.locator("button:has-text('关闭应用锁')").click()
                page.wait_for_timeout(400)
                ok("应用锁-关闭", page.locator("text=未开启").count() > 0)
            shot("08-settings-final.png")
        section("设置(主题+应用锁)", s_settings)

        def s_verify_sync():
            """真实数据校验: 导入脱敏备份 → 加仓/减仓/全部卖出/转换/定投自动执行/T+1·T+2
            全流程断言 投资↔永久 双页总额与分类占比同步 (金额以「分」整数比较)。

            时间控制: page.clock.set_fixed_time 固定"今天", 跨过 T+1/T+2 确认日重算。
            (set_fixed_time 只假日期、保留计时器, 不影响网络与 Vue 渲染)
            """
            def fen(s):
                m = re.search(r"([-+]?\d[\d,]*\.\d{2})", s.replace('¥', ''))
                if not m:
                    raise ValueError(f"无法解析金额: {s!r}")
                return int(round(float(m.group(1).replace(',', '')) * 100))

            def js_round(v):
                return int(math.floor(v + 0.5))

            def goto_tab(label):
                page.locator("a:has-text('%s')" % label).first.click()
                page.wait_for_timeout(700)

            def card_of(name):
                return page.locator("div.card", has_text=name).first

            def card_qty(name):
                # snapshot() 会把页面留在「永久」, 读持仓卡前先回到「投资」
                goto_tab("投资")
                return float(card_of(name).locator("div.rounded-lg").nth(0).locator(".money").inner_text())

            def invest_total():
                return fen(page.locator("div.money.text-3xl").first.inner_text())

            def snapshot():
                goto_tab("投资")
                inv = invest_total()
                goto_tab("永久")
                perm = invest_total()
                stock = fen(page.locator("div.card", has_text="目标").filter(has_text="股票").locator(".money").first.inner_text())
                bond = fen(page.locator("div.card", has_text="目标").filter(has_text="债券").locator(".money").first.inner_text())
                return inv, perm, stock, bond

            def open_card_detail(name):
                back_to_portfolio()
                card_of(name).locator("button", has_text=name).first.click()
                page.wait_for_url(re.compile(r"/holding/"), timeout=5000)
                page.wait_for_timeout(600)

            def back_to_portfolio():
                page.locator("a:has-text('投资')").first.click()
                page.wait_for_timeout(700)

            def advance(d):
                """推进固定时钟到 d 并强制重算: 通过 永久→投资 跨路由重挂载,
                使 Portfolio.onMounted → refresh() 以新的"今天"重算持仓。
                (仅 set_fixed_time + 同路由导航不会重挂载, 结算状态会停留在旧日期)"""
                page.clock.set_fixed_time(f"{d}T12:00:00Z")
                goto_tab("永久")
                goto_tab("投资")

            def trade_on_card(name, action, mode_btn, value):
                """在投资页持仓卡打开 加仓/减仓 抽屉并提交"""
                back_to_portfolio()
                card_of(name).locator("button", has_text=action).click()
                page.wait_for_selector(".sheet-panel", timeout=5000)
                page.locator(".sheet-panel button", has_text=mode_btn).click()
                page.wait_for_timeout(200)
                page.locator(".sheet-panel input[type='number']").first.fill(str(value))
                page.wait_for_timeout(250)
                page.locator(".sheet-panel button", has_text="确认").click()
                page.wait_for_timeout(800)
                return page.locator(".sheet-panel").count() == 0

            # ---- 0. 清库 → 设置页导入脱敏真实备份 fixture ----
            page.evaluate("""() => new Promise(res => {
                const q = indexedDB.deleteDatabase('func-db');
                q.onsuccess = q.onerror = q.onblocked = () => res(null);
            })""")
            page.goto(BASE, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(600)
            page.locator("a[aria-label='设置']").first.click()
            page.wait_for_timeout(400)
            page.set_input_files("input[type=file]", files=[
                {"name": "backup.json", "mimeType": "application/json", "buffer": BUNDLE_BYTES}])
            page.wait_for_selector("text=/导入成功/", timeout=6000)
            ok("校验-导入真实备份fixture成功", True)
            page.goto(BASE, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(900)

            # 固定"今天"= 2026-08-13 (周四), 保证 T+1/T+2 确认日确定
            page.clock.set_fixed_time("2026-08-13T12:00:00Z")

            # ---- 1. 投资页: 16 持仓 + 自动拉价回填真实净值 + 基线 ----
            goto_tab("投资")
            deadline = time.time() + 15
            while time.time() < deadline and page.locator("text=/已更新/").count() == 0:
                page.wait_for_timeout(250)
            page.wait_for_timeout(400)
            ok("校验-导入后16只持仓", page.locator("div.card").count() == 16,
               f"count={page.locator('div.card').count()}")
            ok("校验-真实净值回填(汇添富1.78)",
               card_of("汇添富红利").locator("text=1.78").count() > 0)

            def mv_fen(sym):
                h = next(x for x in FUNDS if x['symbol'] == sym)
                return js_round(_yuan_to_fen(h['navYuan']) * h['quantity'])

            def cat_of(name, symbol):
                s = name + ' ' + symbol
                if re.search(r'红利|股息|dividend', s, re.I): return 'stock'
                if re.search(r'标普|s&p|sp500|spy|spx', s, re.I): return 'stock'
                if re.search(r'纳指|纳斯达克|qqq|ndx|nasdaq', s, re.I): return 'stock'
                if re.search(r'债|bond', s, re.I): return 'bond'
                return 'stock'  # 其他+etf → 永久默认归股票

            expected0 = sum(mv_fen(h['symbol']) for h in FUNDS)
            stock0 = sum(mv_fen(h['symbol']) for h in FUNDS if cat_of(h['name'], h['symbol']) == 'stock')
            bond0 = sum(mv_fen(h['symbol']) for h in FUNDS if cat_of(h['name'], h['symbol']) == 'bond')

            inv0, perm0, stk0, bnd0 = snapshot()
            ok("校验-基线投资总额=Σ份额×真实净值(分)", inv0 == expected0, f"got={inv0} exp={expected0}")
            ok("校验-基线投资↔永久总额一致", perm0 == inv0)
            ok("校验-基线股票分类小计(分)", stk0 == stock0, f"got={stk0} exp={stock0}")
            ok("校验-基线债券分类小计(分)", bnd0 == bond0, f"got={bnd0} exp={bond0}")

            # ---- 2.2 加仓 ¥100 (T+1 当日 → 确认中, 不计入收益) ----
            q0 = card_qty("汇添富红利")
            done = trade_on_card("汇添富红利", "加仓", "按金额", 100)
            ok("加仓-提交抽屉关闭", done)
            ok("加仓-T+1当日份额未计入(确认中)", card_qty("汇添富红利") == q0,
               f"{q0} → {card_qty('汇添富红利')}")
            inv_a, perm_a, stk_a, bnd_a = snapshot()
            ok("加仓-T+1当日投资总额不变", inv_a == inv0)
            ok("加仓-T+1当日永久总额不变", perm_a == inv0 and perm_a == inv_a)
            open_card_detail("汇添富红利")
            ok("加仓-详情页确认中买入区块", page.locator("text=确认中买入").count() > 0)
            ok("加仓-交易记录确认日 T+1 08-14", page.locator("text=/确认中 · 2026-08-14/").count() > 0)
            back_to_portfolio()

            # ---- 2.7 次日确认计入 (T+1) ----
            advance("2026-08-14")
            q_after_add = q0 + 10000 / 178
            qty1 = card_qty("汇添富红利")
            ok("加仓-次日确认份额计入", abs(qty1 - q_after_add) < 0.01, f"exp≈{q_after_add:.4f} got={qty1}")
            inv1, perm1, stk1, bnd1 = snapshot()
            ok("加仓-投资总额同步+100元(分)", inv1 == inv0 + 10000, f"{inv0}→{inv1}")
            ok("加仓-永久总额同步增加", perm1 == inv1)
            ok("加仓-股票分类同步+100元(分)", stk1 == stk0 + 10000, f"{stk0}→{stk1}")

            # ---- 2.3 减仓 20 份 (T+1 当日 → 冻结, 两页同步减少待确认) ----
            done = trade_on_card("汇添富红利", "减仓", "按份额", 20)
            ok("减仓-提交抽屉关闭", done)
            ok("减仓-T+1当日份额未变(冻结中)", abs(card_qty("汇添富红利") - qty1) < 0.01)
            inv_b, perm_b, stk_b, bnd_b = snapshot()
            ok("减仓-T+1当日两页总额不变", perm_b == inv_b == inv1)
            open_card_detail("汇添富红利")
            ok("减仓-详情页冻结份额20", page.locator("text=/冻结份额/").count() > 0 and page.locator("text=20.00").count() > 0)
            ok("减仓-交易记录在途 T+1 08-17", page.locator("text=/在途 · 2026-08-17/").count() > 0)
            back_to_portfolio()

            advance("2026-08-17")
            qty2 = qty1 - 20
            ok("减仓-次日确认份额-20", abs(card_qty("汇添富红利") - qty2) < 0.01, f"exp={qty2:.4f}")
            inv2, perm2, stk2, bnd2 = snapshot()
            sell20 = js_round(178 * 20)
            ok("减仓-投资总额同步-20份市值(分)", inv2 == inv1 - sell20, f"{inv1}→{inv2} (Δ{-sell20})")
            ok("减仓-永久总额同步减少", perm2 == inv2)
            ok("减仓-股票分类同步-20份市值(分)", stk2 == stk1 - sell20, f"{stk1}→{stk2}")

            # ---- 2.4 全部卖出 (按份额=持有数) ----
            held = card_qty("汇添富红利")
            done = trade_on_card("汇添富红利", "减仓", "按份额", held)
            ok("全部卖出-提交抽屉关闭", done)
            open_card_detail("汇添富红利")
            ok("全部卖出-T+1当日仍在途", page.locator("text=/在途 · 2026-08-18/").count() > 0)
            back_to_portfolio()
            advance("2026-08-18")
            ok("全部卖出-数量归零", card_qty("汇添富红利") == 0)
            ok("全部卖出-已清仓标签", card_of("汇添富红利").locator("text=已清仓").count() > 0)
            inv3, perm3, stk3, bnd3 = snapshot()
            closed_mv = js_round(178 * qty2)
            ok("全部卖出-投资总额扣减持仓市值(分)", inv3 == inv2 - closed_mv, f"{inv2}→{inv3} (Δ{-closed_mv})")
            ok("全部卖出-永久总额同步扣减", perm3 == inv3)
            ok("全部卖出-股票分类同步扣减(分)", stk3 == stk2 - closed_mv, f"{stk2}→{stk3}")

            # ---- 2.5 超级转换: 富国恒生红利(全部) → 新基金 008888 (QDII → 自动建仓 T+2) ----
            src_mv = mv_fen('019261')  # 019261 无历史操作, 市值=基线
            back_to_portfolio()
            card_of("富国恒生红利").locator("button", has_text="转换").click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".sheet-panel input[placeholder*='006260']").fill("008888")
            page.locator(".sheet-panel input[placeholder*='易方达']").fill("广发纳斯达克100ETF联接(QDII)C")
            page.locator(".sheet-panel input[placeholder*='0.0000']").fill("2.0000")
            page.wait_for_timeout(400)
            ok("转换-转出金额预览", page.locator(".sheet-panel .bg-surface2 .money").count() >= 2)
            page.locator(".sheet-panel button", has_text="确认转换").click()
            page.wait_for_timeout(900)
            ok("转换-新基金自动建仓", page.locator("div.card", has_text="广发纳斯达克100ETF联接(QDII)C").count() > 0)
            ok("转换-源持仓未清仓(在途)", card_of("富国恒生红利").locator("text=已清仓").count() == 0)
            inv4, perm4, stk4, bnd4 = snapshot()
            ok("转换-T+2确认前两页总额不变", perm4 == inv4 == inv3)
            open_card_detail("富国恒生红利")
            ok("转换-源卖出交易", page.locator("text=/转换出→008888/").count() > 0)
            back_to_portfolio()
            advance("2026-08-20")
            ok("转换-源持仓确认后已清仓", card_of("富国恒生红利").locator("text=已清仓").count() > 0)
            open_card_detail("广发纳斯达克100ETF联接(QDII)C")
            ok("转换-QDII新基金 T+2 标记", page.locator("text=T+2").count() > 0)
            ok("转换-目标买入交易", page.locator("text=/转换入←019261/").count() > 0)
            back_to_portfolio()
            inv5, perm5, stk5, bnd5 = snapshot()
            ok("转换-两页总额持平(资产置换, 分)", abs(inv5 - inv3) <= 2 and perm5 == inv5,
               f"inv3={inv3} inv5={inv5}")
            ok("转换-股票分类持平(源/目标均股票, 分)", abs(stk5 - stk3) <= 2, f"stk3={stk3} stk5={stk5}")

            # ---- 2.7 T+2 当日买入确认日推算 ----
            q_t2_0 = card_qty("广发纳斯达克100ETF联接(QDII)C")
            done = trade_on_card("广发纳斯达克100ETF联接(QDII)C", "加仓", "按金额", 50)
            ok("T2-加仓提交完成", done)
            ok("T2-当日份额未计入(T+2在途)", abs(card_qty("广发纳斯达克100ETF联接(QDII)C") - q_t2_0) < 0.01,
               f"{q_t2_0} → {card_qty('广发纳斯达克100ETF联接(QDII)C')}")
            open_card_detail("广发纳斯达克100ETF联接(QDII)C")
            ok("T2-加仓确认中·08-24(T+2跨周末)", page.locator("text=/确认中 · 2026-08-24/").count() > 0)
            back_to_portfolio()

            # ---- 2.6 周度定投自动执行 (目标基金 → buy 交易, 幂等) ----
            q_dca0 = card_qty("兴业120天")
            goto_tab("定投")
            page.wait_for_selector("button:has-text('立即配置')", timeout=6000)
            page.locator("button:has-text('立即配置')").click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".sheet-panel input[type='number']").first.fill("400")
            page.locator(".sheet-panel select").select_option(label="兴业120天滚动持有债券A (016816)")
            page.locator(".sheet-panel button", has_text="保存").click()
            page.wait_for_timeout(700)
            # 重进定投页 → onMounted 自动执行
            goto_tab("投资")
            goto_tab("定投")
            page.wait_for_selector("text=/本周已自动定投/", timeout=8000)
            ok("定投-自动执行提示", page.locator("text=/本周已自动定投/").count() > 0)
            open_card_detail("兴业120天")
            ok("定投-目标基金 buy 交易", page.locator("text=/定投自动执行·W3/").count() > 0)
            ok("定投-buy 交易确认中 T+1 08-21", page.locator("text=/确认中 · 2026-08-21/").count() > 0)
            back_to_portfolio()
            # 次日确认 → 份额增加
            advance("2026-08-21")
            q_dca1 = card_qty("兴业120天")
            ok("定投-目标基金份额增加", q_dca1 > q_dca0, f"{q_dca0}→{q_dca1}")
            # 幂等: 同周再进定投不重复执行
            goto_tab("定投")
            page.wait_for_timeout(1200)
            ok("定投-幂等(同日重复触发无新执行)", page.locator("text=/本周已自动定投/").count() == 0)
            back_to_portfolio()
            ok("定投-幂等(份额不再增加)", card_qty("兴业120天") == q_dca1,
               f"{q_dca1} → {card_qty('兴业120天')}")

            shot("99-verify-final.png")

        section("真实数据(导入+交易+同步+T1T2+定投)", s_verify_sync)

        browser.close()

    print("\n" + "=" * 52)
    passed = sum(1 for _, c, _ in results if c)
    print(f"E2E 功能检查: {passed}/{len(results)} 通过")
    failed = [(n, d) for n, c, d in results if not c]
    for n, d in failed:
        print(f"  ✗ {n} — {d}")

    exp = ["failed to fetch", "net::err", "err_failed", "corsproxy", "allorigins",
           "codetabs", "yahoo", "stooq", "load failed"]
    real = [e for e in (console_errors + page_errors) if not any(x in e.lower() for x in exp)]
    print(f"控制台/页面错误: {len(console_errors)+len(page_errors)} 条 (非预期: {len(real)})")
    for e in real[:10]:
        print(f"  ⚠ {e[:180]}")
    return 0 if (passed == len(results) and not real) else 1


def main():
    if not os.path.isdir("dist"):
        print("✗ 未找到 dist/, 请先 npm run build"); return 2
    print(f"启动 preview 服务 (port {PORT})...")
    proc = subprocess.Popen(
        ["npm", "run", "preview", "--", "--port", str(PORT), "--strictPort"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if os.name != "nt" else None,
    )
    try:
        if not wait_for(BASE):
            print("✗ preview 服务未就绪"); return 3
        print("服务就绪, 开始测试\n")
        return run_tests()
    finally:
        try:
            if os.name != "nt":
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
