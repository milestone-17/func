#!/usr/bin/env python3
"""
本地财务 PWA 端到端测试 (自包含: 自动起 preview 服务 → 跑测试 → 收尾)

用法:
  1. 先构建: npm run build
  2. 跑 E2E: python3 tests/e2e/app.py

依赖: playwright + chromium
  pip install playwright && python -m playwright install chromium
"""
import sys, os, time, signal, subprocess, urllib.request, traceback
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173/func/"
PORT = 4173
SHOTS = os.environ.get("E2E_SHOTS", "/tmp/func-e2e-shots/")


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
            page.locator(".sheet-panel .amount-input input").fill("200")
            page.locator(".sheet-panel input[placeholder='0']").fill("10")
            page.locator(".sheet-panel button:has-text('保存')").click()
            page.wait_for_timeout(900)
            shot("04-portfolio.png")
            ok("投资-建仓后显示", page.locator("text=苹果").count() > 0)
        section("投资(建仓)", s_portfolio)

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
            ok("定投-MA250年线", page.locator("text=MA250").count() > 0)
            ok("定投-MA120半年线", page.locator("text=MA120").count() > 0)
            ok("定投-偏离档位表", page.locator("text=偏离档位表").count() > 0)
            ok("定投-4周建议", page.locator("text=/建议投入|按建议投入/").count() > 0)
            ok("定投-图表canvas", page.locator("canvas").count() > 0)
        section("定投(NDX+双均线+建议)", s_dca)

        def s_perm():
            page.locator("a:has-text('永久')").first.click()
            page.wait_for_timeout(500)
            shot("06-permanent.png")
            ok("永久-四类资产", page.locator("text=股票").count() > 0 and page.locator("text=黄金").count() > 0)
            ok("永久-组合总市值", page.locator("text=组合总市值").count() > 0)
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
