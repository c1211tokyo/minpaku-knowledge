#!/usr/bin/env python3
"""Validate Minpaku Knowledge without third-party dependencies."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
SITE_DOMAIN = "minpakuk.1211.world"


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        if tag in {"img", "script", "link"} and values.get("src"):
            self.links.append(values["src"] or "")
        if tag == "link" and values.get("href"):
            self.links.append(values["href"] or "")


def resolve_internal(page: Path, href: str) -> Path | None:
    clean = href.split("#", 1)[0].split("?", 1)[0]
    if not clean or clean.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    parsed = urlparse(clean)
    if parsed.scheme in {"http", "https"}:
        if parsed.netloc != SITE_DOMAIN:
            return None
        clean = parsed.path
    if clean.startswith("/"):
        target = ROOT / unquote(clean.lstrip("/"))
    else:
        target = (page.parent / unquote(clean)).resolve()
    if clean.endswith("/") or target.is_dir():
        target = target / "index.html"
    return target


def load_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def external_urls(html_files: list[Path]) -> set[str]:
    urls: set[str] = set()
    for page in html_files:
        parser = LinkParser()
        parser.feed(page.read_text(encoding="utf-8"))
        for href in parser.links:
            parsed = urlparse(href)
            if parsed.scheme in {"http", "https"} and parsed.netloc != SITE_DOMAIN:
                urls.add(href.split("#", 1)[0])
    for source in load_json(ROOT / "data" / "sources.json"):
        urls.add(source["url"])
    for ward in load_json(ROOT / "data" / "wards.json"):
        urls.add(ward["officialUrl"])
    return urls


def check_external(url: str) -> tuple[str, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; MinpakuKnowledgeLinkCheck/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status = getattr(response, "status", 200)
            if 200 <= status < 400:
                return "ok", str(status)
            return "error", str(status)
    except urllib.error.HTTPError as error:
        if error.code in {401, 403, 405, 429}:
            return "warning", str(error.code)
        return "error", str(error.code)
    except Exception as error:  # network instability is a warning, not a legal-content change
        return "warning", error.__class__.__name__


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--external", action="store_true", help="Check external official links")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    html_files = sorted(ROOT.rglob("*.html"))
    if not html_files:
        errors.append("No HTML files found")

    for page in html_files:
        text = page.read_text(encoding="utf-8")
        if page.name != "404.html":
            for marker in ('id="main-content"', "data-site-header", "data-site-footer"):
                if marker not in text:
                    errors.append(f"{page.relative_to(ROOT)} missing {marker}")
            if '<link rel="canonical"' not in text:
                errors.append(f"{page.relative_to(ROOT)} missing canonical URL")
            if "<h1" not in text:
                errors.append(f"{page.relative_to(ROOT)} missing H1")
        parser_obj = LinkParser()
        parser_obj.feed(text)
        for href in parser_obj.links:
            target = resolve_internal(page, href)
            if target is not None and not target.exists():
                errors.append(
                    f"{page.relative_to(ROOT)} -> missing {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}"
                )

    wards = load_json(ROOT / "data" / "wards.json")
    if len(wards) != 23:
        errors.append(f"Expected 23 wards, found {len(wards)}")
    slugs = [ward["slug"] for ward in wards]
    if len(slugs) != len(set(slugs)):
        errors.append("Duplicate ward slug")
    today = date.today()
    for ward in wards:
        page = ROOT / "tokyo" / ward["slug"] / "index.html"
        if not page.exists():
            errors.append(f"Missing ward page: {ward['slug']}")
        else:
            page_text = page.read_text(encoding="utf-8")
            if ward["name"] not in page_text:
                errors.append(f"Ward page {ward['slug']} missing ward name")
            if ward["officialUrl"] not in page_text:
                errors.append(f"Ward page {ward['slug']} missing official URL")
        for field in ("name", "department", "phone", "officialUrl", "lastVerified", "reviewDue"):
            if not ward.get(field):
                errors.append(f"Ward {ward['slug']} missing {field}")
        due = date.fromisoformat(ward["reviewDue"])
        if due < today:
            errors.append(f"Ward {ward['name']} review overdue: {due}")

    search_entries = load_json(ROOT / "data" / "search-index.json")
    seen_urls: set[str] = set()
    for entry in search_entries:
        if entry["url"] in seen_urls:
            errors.append(f"Duplicate search URL: {entry['url']}")
        seen_urls.add(entry["url"])
        target = resolve_internal(ROOT / "index.html", entry["url"])
        if target is not None and not target.exists():
            errors.append(f"Search index target missing: {entry['url']}")

    for json_file in sorted((ROOT / "data").glob("*.json")):
        try:
            load_json(json_file)
        except Exception as error:
            errors.append(f"Invalid JSON {json_file.name}: {error}")

    sitemap_root = ET.parse(ROOT / "sitemap.xml").getroot()
    sitemap_urls = {
        node.text
        for node in sitemap_root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
        if node.text
    }
    expected_urls = {
        "https://" + SITE_DOMAIN + ("/" if page == ROOT / "index.html" else "/" + str(page.parent.relative_to(ROOT)).replace("\\", "/") + "/")
        for page in html_files
        if page.name != "404.html"
    }
    missing_sitemap = expected_urls - sitemap_urls
    extra_sitemap = sitemap_urls - expected_urls
    for url in sorted(missing_sitemap):
        errors.append(f"Sitemap missing: {url}")
    for url in sorted(extra_sitemap):
        errors.append(f"Sitemap target has no page: {url}")

    if args.external:
        urls = sorted(external_urls(html_files))
        for index, url in enumerate(urls, 1):
            result, detail = check_external(url)
            print(f"[external {index}/{len(urls)}] {result.upper():7} {detail:12} {url}")
            if result == "error":
                errors.append(f"External link failed ({detail}): {url}")
            elif result == "warning":
                warnings.append(f"External link inconclusive ({detail}): {url}")
            time.sleep(0.15)

    print(f"Checked {len(html_files)} HTML files, {len(wards)} wards, {len(search_entries)} search entries.")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"Validation failed with {len(errors)} error(s).")
        return 1
    print("Validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
