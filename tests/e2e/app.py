#!/usr/bin/env python3
"""
本地财务 PWA 端到端测试 (自包含: 自动起 preview 服务 → 跑测试 → 收尾)

用法:
  1. 先构建: npm run build
  2. 跑 E2E: python3 tests/e2e/app.py

依赖: playwright + chromium
  pip install playwright && python -m playwright install chromium
"""
import sys, os, time, signal, subprocess, urllib.request, traceback, re
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173/func/"
PORT = 4173
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/func-e2e-shots/")

# 东财移动端基金批量接口的固定返回 (模拟真实响应结构, 供批量 JSONP 回填净值)
FUND_NAV_FIXTURES = [
    ("006260", "汇添富红利增长混合C", "1.7811"),
    ("019261", "富国恒生红利ETF联接C", "1.2267"),
]


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
