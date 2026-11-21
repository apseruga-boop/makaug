#!/usr/bin/env python3
"""Local visual check of the Kampala Vibe City skin at 1366 and 390.

Loads public makaug.com pages with a fresh, cookieless browser, injects the
branch assets, and writes PNGs to /workspace/vibe-city-skin/. Does not sign
in, sign out, or store cookies. Not a production server.
"""
from __future__ import annotations

import asyncio
import mimetypes
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1] / "assets/vibe-city-skin"
OUT = Path(__import__("os").environ.get("VIBE_CITY_SKIN_SHOTS", "/workspace/vibe-city-skin"))
CHROME = "/usr/bin/google-chrome"

PAGES = [
    ("home", "https://makaug.com/", None),
    ("results_kira", "https://makaug.com/land/kira-wakiso", None),
    ("listing", "https://makaug.com/property/7eb19e42-cf04-4fee-8dee-8f8f3beee3b8", None),
    ("list_property", "https://makaug.com/list-property", None),
    ("confirm", "https://makaug.com/list-property?skin=confirm", "confirm"),
    ("home_after_window", "https://makaug.com/?skin_at=2026-11-30T00:00:00+03:00", "off"),
]

VIEWPORTS = {
    "1366": {"width": 1366, "height": 900, "device_scale_factor": 1, "is_mobile": False},
    "390": {"width": 390, "height": 844, "device_scale_factor": 2, "is_mobile": True},
}


async def route_assets(page):
    async def handle(route):
        rel = route.request.url.split("/assets/vibe-city-skin/", 1)[-1].split("?", 1)[0]
        path = ROOT / rel
        if not path.exists() or not path.is_file():
            await route.fulfill(status=404, body=b"missing")
            return
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix == ".webp":
            ctype = "image/webp"
        elif path.suffix == ".woff2":
            ctype = "font/woff2"
        elif path.suffix == ".css":
            ctype = "text/css"
        elif path.suffix == ".js":
            ctype = "application/javascript"
        await route.fulfill(
            status=200,
            path=str(path),
            headers={"Content-Type": ctype, "Access-Control-Allow-Origin": "*"},
        )

    await page.route("**/assets/vibe-city-skin/**", handle)


async def inject_boot(page):
    await page.add_script_tag(path=str(ROOT / "window.js"))
    await page.add_script_tag(path=str(ROOT / "boot.js"))


async def dismiss_list_modal(page):
    await page.evaluate(
        """() => {
          const overlays = [...document.querySelectorAll('.modal-overlay')];
          for (const d of overlays) {
            if (/CHOOSE LISTING PATH/i.test(d.innerText || '')) {
              const btn = [...d.querySelectorAll('button')].find((b) =>
                /^[\\s]*[\\u2715\\u00d7xX][\\s]*$/.test(b.textContent || '')
              );
              if (btn) { try { btn.click(); } catch (e) {} }
              d.classList.remove('open');
              d.style.display = 'none';
            }
          }
          document.body.classList.remove('modal-open');
        }"""
    )


async def load(context, url):
    page = await context.new_page()
    await route_assets(page)
    page.set_default_timeout(45000)
    await page.goto(url, wait_until="domcontentloaded", timeout=45000)
    try:
        await page.wait_for_selector("html.app-ready, #hero-title, a[href='/']", timeout=20000)
    except Exception:
        pass
    try:
        await page.wait_for_load_state("networkidle", timeout=20000)
    except Exception:
        pass
    await page.wait_for_timeout(2000)
    return page


async def capture(browser, name, url, kind, viewport_name, viewport):
    kwargs = dict(
        viewport={"width": viewport["width"], "height": viewport["height"]},
        device_scale_factor=viewport["device_scale_factor"],
        java_script_enabled=True,
    )
    if viewport["is_mobile"]:
        kwargs.update(
            is_mobile=True,
            has_touch=True,
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ),
        )
    context = await browser.new_context(**kwargs)
    page = await load(context, url)
    await inject_boot(page)
    if "list-property" in url:
        await dismiss_list_modal(page)
        await page.wait_for_timeout(400)
        await dismiss_list_modal(page)
    await page.wait_for_timeout(800)
    await page.evaluate("window.scrollTo(0,0)")
    if kind != "off":
        await page.wait_for_timeout(700)
    out = OUT / f"{name}_{viewport_name}.png"
    OUT.mkdir(parents=True, exist_ok=True)
    await page.screenshot(path=str(out), type="png", full_page=False)
    print(f"  wrote {out.name}  {out.stat().st_size // 1024}k")
    # sanity flags
    flags = await page.evaluate(
        """() => ({
          mode: document.body.getAttribute('data-vc-mode') || '',
          skin: document.body.classList.contains('vc-skin'),
          title: (document.getElementById('hero-title') || {}).innerText || '',
          strip: Boolean(document.getElementById('vc-mission-strip')),
          confirm: Boolean(document.getElementById('vc-confirm-wrap')),
          list: Boolean(document.getElementById('vc-list-hero'))
        })"""
    )
    print(f"    {flags}")
    await context.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            headless=True,
        )
        for name, url, kind in PAGES:
            print(f"\n=== {name} ===")
            for vp_name, vp in VIEWPORTS.items():
                await capture(browser, name, url, kind, vp_name, vp)
        await browser.close()
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
