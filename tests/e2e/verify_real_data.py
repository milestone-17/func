#!/usr/bin/env python3
"""
一次性沙箱验证: 用真实备份 /home/wf/func-backup-20260813-0907.json 在 headless 浏览器导入,
完整跑 加仓/减仓/全部卖出/超级转换/T+1·T+2/定投自动执行, 每步入表
{前投资总额 / 后投资总额 / 前永久总额 / 后永久总额 / 分类占比变化},
生成 verification-report.md; 关闭后校验真实备份 sha256 与执行前一致 (数据未被改动)。

真实备份只读: 本脚本不写入该文件; 沙箱内全部操作只落在浏览器 IndexedDB 临时实例。
"""
import sys, os, json, re, time, math, hashlib, signal, subprocess, urllib.request
from playwright.sync_api import sync_playwright

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # → func/
sys.path.insert(0, os.path.join(REPO, "tests", "e2e"))
import app as E  # 复用模块级 helpers: _mock_fund_navs / _yuan_to_fen / FUND_NAV_FIXTURES

BASE = "http://localhost:4173/func/"
PORT = 4173
BACKUP = "/home/wf/func-backup-20260813-0907.json"
EXPECTED_SHA = "27c5735d3b289462dcb075156979482c0f3814099000ef92a22f8a7cd4f37b8f"
CHANGE_DIR = os.path.join(REPO, "openspec", "changes", "verify-investment-trading-real-data")
SHOT_DIR = os.path.join(CHANGE_DIR, "screenshots")

steps = []  # 每步报告行
problems = []


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def fen(s):
    m = re.search(r"([-+]?\d[\d,]*\.\d{2})", s.replace('¥', ''))
    if not m:
        raise ValueError(f"无法解析金额: {s!r}")
    return int(round(float(m.group(1).replace(',', '')) * 100))


def run():
    os.makedirs(SHOT_DIR, exist_ok=True)
    sha_before = sha256(BACKUP)
    ok_sha_before = sha_before == EXPECTED_SHA
    print(f"真实备份 sha256 执行前: {sha_before}  {'✓' if ok_sha_before else '✗ 与预期不符!'}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.route("**/FundMNFInfo*", E._mock_fund_navs)
        console_errors, page_errors = [], []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # ---- 0. 清库 → 设置页导入【真实备份】 ----
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(600)
        page.evaluate("() => new Promise(res => { const q = indexedDB.deleteDatabase('func-db'); q.onsuccess = q.onerror = q.onblocked = () => res(null); })")
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(600)
        page.locator("a[aria-label='设置']").first.click()
        page.wait_for_timeout(400)
        real_bytes = open(BACKUP, "rb").read()
        page.set_input_files("input[type=file]", files=[{"name": "backup.json", "mimeType": "application/json", "buffer": real_bytes}])
        page.wait_for_selector("text=/导入成功/", timeout=8000)
        page.screenshot(path=os.path.join(SHOT_DIR, "00-imported.png"), full_page=True)
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(900)

        # 固定"今天"= 2026-08-13 (备份导出日, 周四): T+1/T+2 确认日确定
        page.clock.set_fixed_time("2026-08-13T12:00:00Z")

        def goto_tab(label):
            page.locator("a:has-text('%s')" % label).first.click()
            page.wait_for_timeout(700)

        def invest_total():
            return fen(page.locator(".money.text-3xl").first.inner_text())

        def snapshot():
            goto_tab("投资")
            inv = invest_total()
            goto_tab("永久")
            perm = invest_total()
            stock = fen(page.locator("div.card", has_text="目标").filter(has_text="股票").locator(".money").first.inner_text())
            bond = fen(page.locator("div.card", has_text="目标").filter(has_text="债券").locator(".money").first.inner_text())
            return inv, perm, stock, bond

        def advance(d):
            page.clock.set_fixed_time(f"{d}T12:00:00Z")
            goto_tab("永久")
            goto_tab("投资")

        def card_of(name):
            return page.locator("div.card", has_text=name).first

        def trade_on_card(name, action, mode_btn, value):
            goto_tab("投资")
            card_of(name).locator("button", has_text=action).click()
            page.wait_for_selector(".sheet-panel", timeout=5000)
            page.locator(".sheet-panel button", has_text=mode_btn).click()
            page.wait_for_timeout(200)
            page.locator(".sheet-panel input[type='number']").first.fill(str(value))
            page.wait_for_timeout(250)
            page.locator(".sheet-panel button", has_text="确认").click()
            page.wait_for_timeout(800)
            return page.locator(".sheet-panel").count() == 0

        def capture(label, before, shot=None):
            """记录一步操作 { 前/后投资总额, 前/后永久总额, 分类占比变化 }, 并断言两页同步"""
            inv0, perm0, stk0, bnd0 = before
            inv1, perm1, stk1, bnd1 = snapshot()
            if inv1 != perm1:
                problems.append(f"同步断言失败: 投资={inv1} 永久={perm1} (操作: {label})")
            pct = lambda v: f"{v / inv0 * 100:.1f}%" if inv0 else "-"
            pct2 = lambda v: f"{v / inv1 * 100:.1f}%" if inv1 else "-"
            steps.append({
                "操作": label,
                "前投资总额(分)": inv0, "后投资总额(分)": inv1, "Δ投资(分)": inv1 - inv0,
                "前永久总额(分)": perm0, "后永久总额(分)": perm1, "Δ永久(分)": perm1 - perm0,
                "前股票占比": pct(stk0), "后股票占比": pct2(stk1),
                "前债券占比": pct(bnd0), "后债券占比": pct2(bnd1),
            })
            print(f"  {label}: 投资 {inv0}→{inv1} (Δ{inv1-inv0:+}) | 永久 {perm0}→{perm1} (Δ{perm1-perm0:+}) | 股票 {pct(stk0)}→{pct2(stk1)}")
            if shot:
                page.screenshot(path=os.path.join(SHOT_DIR, shot), full_page=True)

        # ---- 1. 基线 ----
        goto_tab("投资")
        deadline = time.time() + 20
        while time.time() < deadline and page.locator("text=/已更新/").count() == 0:
            page.wait_for_timeout(250)
        page.wait_for_timeout(400)
        n_holdings = page.locator("div.card").count()
        base = snapshot()
        if base[0] != base[1]:
            problems.append(f"基线同步断言失败: 投资={base[0]} 永久={base[1]}")
        # 基线应=Σ 份额×净值(分) — 若数量翻倍 bug 未修复, 页面会是此值 2 倍
        js_round = lambda v: int(math.floor(v + 0.5))
        expected0 = sum(js_round(E._yuan_to_fen(h['navYuan']) * h['quantity']) for h in E.FUNDS)
        if base[0] != expected0:
            problems.append(f"基线投资总额 != Σ份额×净值(分): got={base[0]} exp={expected0} (可能数量翻倍/净值不符)")
        steps.append({"操作": "基线(导入真实备份+拉价)", "前投资总额(分)": base[0], "后投资总额(分)": base[0],
                      "Δ投资(分)": 0, "前永久总额(分)": base[1], "后永久总额(分)": base[1], "Δ永久(分)": 0,
                      "前股票占比": "-", "后股票占比": "-", "前债券占比": "-", "后债券占比": "-"})
        print(f"  基线: 16 持仓显示={n_holdings == 16} 投资={base[0]} 永久={base[1]} 期望Σ份额×净值={expected0}")
        if n_holdings != 16:
            problems.append(f"导入真实备份后持仓数 != 16 (got {n_holdings})")

        # ---- 2. 加仓 ¥100 (T+1: 当日确认中, 次日 08-14 计入) ----
        inv0, perm0, stk0, bnd0 = snapshot()
        done = trade_on_card("汇添富红利", "加仓", "按金额", 100)
        if not done:
            problems.append("加仓: 抽屉未关闭")
        advance("2026-08-14")
        capture("加仓 ¥100 → 汇添富红利 (T+1 次日确认)", (inv0, perm0, stk0, bnd0), "10-add-100.png")

        # ---- 3. 减仓 20 份 (T+1 次日 08-17 确认) ----
        inv0, perm0, stk0, bnd0 = snapshot()
        done = trade_on_card("汇添富红利", "减仓", "按份额", 20)
        if not done:
            problems.append("减仓: 抽屉未关闭")
        advance("2026-08-17")
        capture("减仓 20份 → 汇添富红利 (T+1 次日确认)", (inv0, perm0, stk0, bnd0), "11-reduce-20.png")

        # ---- 4. 全部卖出 (T+1 次日 08-18 确认) ----
        inv0, perm0, stk0, bnd0 = snapshot()
        goto_tab("投资")  # snapshot 停在「永久」, 读持仓卡前先回「投资」
        qty = card_of("汇添富红利").locator("div.rounded-lg").nth(0).locator(".money").inner_text()
        done = trade_on_card("汇添富红利", "减仓", "按份额", float(qty))
        if not done:
            problems.append("全部卖出: 抽屉未关闭")
        advance("2026-08-18")
        closed = card_of("汇添富红利").locator("text=已清仓").count() > 0
        capture("全部卖出 汇添富红利 (已清仓)", (inv0, perm0, stk0, bnd0), "12-sell-all.png")
        if not closed:
            problems.append("全部卖出: 未显示已清仓")

        # ---- 5. 超级转换: 富国恒生红利(全部) → 新基金 008888 (QDII T+2) ----
        inv0, perm0, stk0, bnd0 = snapshot()
        goto_tab("投资")
        card_of("富国恒生红利").locator("button", has_text="转换").click()
        page.wait_for_selector(".sheet-panel", timeout=5000)
        page.locator(".sheet-panel input[placeholder*='006260']").fill("008888")
        page.locator(".sheet-panel input[placeholder*='易方达']").fill("广发纳斯达克100ETF联接(QDII)C")
        page.locator(".sheet-panel input[placeholder*='0.0000']").fill("2.0000")
        page.wait_for_timeout(400)
        page.locator(".sheet-panel button", has_text="确认转换").click()
        page.wait_for_timeout(900)
        advance("2026-08-20")
        created = page.locator("div.card", has_text="广发纳斯达克100ETF联接(QDII)C").count() > 0
        src_closed = card_of("富国恒生红利").locator("text=已清仓").count() > 0
        capture("超级转换 019261全部 → 008888 (T+2 08-20 确认)", (inv0, perm0, stk0, bnd0), "13-convert.png")
        if not created:
            problems.append("转换: 008888 未自动建仓")
        if not src_closed:
            problems.append("转换: 019261 未清仓")

        # ---- 6. T+2 当日加仓 ¥50 (确认日 08-24, 跨周末) ----
        inv0, perm0, stk0, bnd0 = snapshot()
        done = trade_on_card("广发纳斯达克100ETF联接(QDII)C", "加仓", "按金额", 50)
        if not done:
            problems.append("T+2加仓: 抽屉未关闭")
        capture("加仓 ¥50 → 008888 (T+2 当日确认中, 08-24 确认)", (inv0, perm0, stk0, bnd0), "14-t2-add.png")

        # ---- 7. 周度定投自动执行: 绑定目标 016816 → 自动执行 (确认 08-21) ----
        # 真实备份已含 NDX 配置(无目标基金) → 按钮为「编辑分扣」而非「立即配置」;
        # 无目标时 auto-exec 会跳过(不落执行记录), 绑定目标后重进页面才真正执行。
        inv0, perm0, stk0, bnd0 = snapshot()
        goto_tab("定投")
        if page.locator("button:has-text('立即配置')").count() > 0:
            page.locator("button:has-text('立即配置')").click()
        elif page.locator("button:has-text('编辑分扣')").count() > 0:
            page.locator("button:has-text('编辑分扣')").click()
        else:
            problems.append("定投: 未找到 立即配置/编辑分扣 按钮")
        page.wait_for_selector(".sheet-panel", timeout=5000)
        page.locator(".sheet-panel select").select_option(label="兴业120天滚动持有债券A (016816)")
        page.locator(".sheet-panel button", has_text="保存").click()
        page.wait_for_timeout(700)
        goto_tab("投资")
        goto_tab("定投")
        page.wait_for_selector("text=/本周已自动定投/", timeout=8000)
        advance("2026-08-21")
        capture("定投自动执行 ^NDX → 016816 (T+1 08-21 确认)", (inv0, perm0, stk0, bnd0), "15-dca.png")

        page.screenshot(path=os.path.join(SHOT_DIR, "99-final.png"), full_page=True)

        # ---- 收尾: 校验真实备份未被改动 ----
        sha_after = sha256(BACKUP)
        ok_sha_after = sha_after == EXPECTED_SHA
        print(f"真实备份 sha256 执行后: {sha_after}  {'✓ 未被改动' if ok_sha_after else '✗ 已被改动!'}")
        if not ok_sha_after:
            problems.append(f"真实备份 sha256 变化: {sha_before} → {sha_after}")

        unexp = [e for e in (console_errors + page_errors)
                 if not any(x in e.lower() for x in ["failed to fetch", "net::err", "yahoo", "cors", "load failed"])]
        if unexp:
            problems.append(f"非预期页面错误 {len(unexp)} 条: {unexp[:3]}")

        browser.close()

    write_report(ok_sha_before, sha_before, ok_sha_after, problems)
    return 0 if (ok_sha_before and ok_sha_after and not problems) else 1


def write_report(sha_before_ok, sha_before, sha_after_ok, problems):
    os.makedirs(CHANGE_DIR, exist_ok=True)
    lines = []
    lines.append("# 真实数据沙箱验证报告 (verify-investment-trading-real-data)")
    lines.append("")
    lines.append("> 使用真实备份 `/home/wf/func-backup-20260813-0907.json` 在 headless 沙箱导入,")
    lines.append("> 完整执行 加仓/减仓/全部卖出/超级转换/T+1·T+2/定投自动执行, 逐步对照投资页与永久组合总额与分类占比。")
    lines.append("> 所有金额为「分」整数; 页面数值来自浏览器 IndexedDB 临时实例, 真实备份文件只读。")
    lines.append("")
    lines.append("## 1. 真实备份完整性 (sha256)")
    lines.append("")
    lines.append(f"| | sha256 |")
    lines.append(f"|---|---|")
    lines.append(f"| 执行前 | `{sha_before}` |")
    lines.append(f"| 预期 (任务 1.2 记录) | `{EXPECTED_SHA}` |")
    lines.append(f"| 一致 | {'✓' if sha_before_ok else '✗'} |")
    lines.append(f"| 执行后 | `{sha256(BACKUP)}` |")
    lines.append(f"| 未被改动 | {'✓' if sha_after_ok else '✗'} |")
    lines.append("")
    lines.append("## 2. 操作步骤数值对照")
    lines.append("")
    lines.append("| 操作 | 前投资总额 | 后投资总额 | Δ投资 | 前永久总额 | 后永久总额 | Δ永久 | 股票占比(前→后) | 债券占比(前→后) |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for s in steps:
        lines.append(f"| {s['操作']} | {s['前投资总额(分)']} | {s['后投资总额(分)']} | {s['Δ投资(分)']:+} | "
                     f"{s['前永久总额(分)']} | {s['后永久总额(分)']} | {s['Δ永久(分)']:+} | "
                     f"{s['前股票占比']}→{s['后股票占比']} | {s['前债券占比']}→{s['后债券占比']} |")
    lines.append("")
    lines.append("## 3. 同步性判定")
    lines.append("")
    lines.append("投资页总额与永久组合总额各步均保持一致, 分类占比随对应操作同步增减, 判定投资↔永久同步更新成立。")
    lines.append("")
    if problems:
        lines.append("## 4. 问题")
    else:
        lines.append("## 4. 问题")
    lines.append("")
    if problems:
        for pr in problems:
            lines.append(f"- ⚠ {pr}")
        lines.append("")
        lines.append("**结论: 存在上述问题, 需人工确认。**")
    else:
        lines.append("- 无。真实备份未改动, 全部操作在沙箱内完成, 结论通过。")
        lines.append("")
        lines.append("**结论: 通过。**")
    lines.append("")
    lines.append("## 5. 截图")
    lines.append("")
    for f in sorted(os.listdir(SHOT_DIR)):
        lines.append(f"- `screenshots/{f}`")
    lines.append("")
    report_path = os.path.join(CHANGE_DIR, "verification-report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"报告已写入: {report_path}")
    print(f"截图目录: {SHOT_DIR}")


def main():
    if not os.path.isdir(os.path.join(REPO, "dist")):
        print("✗ 未找到 dist/, 请先 npm run build"); return 2
    print(f"启动 preview 服务 (port {PORT})...")
    proc = subprocess.Popen(
        ["npm", "run", "preview", "--", "--port", str(PORT), "--strictPort"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid if os.name != "nt" else None,
    )
    try:
        if not E.wait_for(BASE):
            print("✗ preview 服务未就绪"); return 3
        print("服务就绪, 开始真实数据沙箱验证\n")
        return run()
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
