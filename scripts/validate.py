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
SHARED_NAV_PATHS = {
    "/precheck/",
    "/regimes/compare/",
    "/tokyo/",
    "/operations/",
    "/industry/",
    "/tools/checklists/",
    "/resources/sources/",
    "/resources/methodology/",
    "/resources/updates/",
    "/resources/glossary/",
}


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
        for source in ward.get("minpakuRestriction", {}).get("officialSources", []):
            urls.add(source["url"])
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
    inbound_targets: set[Path] = {ROOT / "index.html"}
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
        for marker in (
            'class="access-pending"',
            '<meta name="robots"',
            '<script src="/assets/site.js"></script>',
            'class="access-noscript"',
        ):
            if marker not in text:
                errors.append(f"{page.relative_to(ROOT)} missing access marker {marker}")
        parser_obj = LinkParser()
        parser_obj.feed(text)
        for href in parser_obj.links:
            target = resolve_internal(page, href)
            if target is not None and not target.exists():
                errors.append(
                    f"{page.relative_to(ROOT)} -> missing {target.relative_to(ROOT) if target.is_relative_to(ROOT) else target}"
                )
            elif target is not None:
                inbound_targets.add(target)

    for href in SHARED_NAV_PATHS:
        target = resolve_internal(ROOT / "index.html", href)
        if target is not None:
            inbound_targets.add(target)

    for page in html_files:
        if page.name == "404.html" or page == ROOT / "index.html":
            continue
        if page not in inbound_targets:
            errors.append(f"Orphan page without HTML or shared-navigation entry: {page.relative_to(ROOT)}")

    if (ROOT / "tools" / "decision" / "index.html").exists():
        errors.append("Retired decision tool page still exists")
    if (ROOT / "data" / "decision-rules.json").exists():
        errors.append("Retired decision rules still exist")

    wards = load_json(ROOT / "data" / "wards.json")
    if len(wards) != 23:
        errors.append(f"Expected 23 wards, found {len(wards)}")
    slugs = [ward["slug"] for ward in wards]
    if len(slugs) != len(set(slugs)):
        errors.append("Duplicate ward slug")
    today = date.today()
    priority_wards = {
        "shinjuku", "shibuya", "toshima", "nakano", "taito",
        "sumida", "chuo", "chiyoda", "arakawa",
    }
    restriction_fields = (
        "researchStatus", "changeStatus", "areaRestriction", "periodRestriction",
        "allowedPeriodSummary", "ownerOccupiedRule", "nonOwnerOccupiedRule",
        "schoolAreaRule", "managementRule", "neighborNotice", "emergencyResponse",
        "wasteRule", "transitionNote", "practicalImpact", "effectiveFrom",
        "officialSources", "verifiedAt", "reviewDue",
    )
    pending_text_fields = (
        "areaRestriction", "periodRestriction", "allowedPeriodSummary",
        "ownerOccupiedRule", "nonOwnerOccupiedRule", "schoolAreaRule",
        "managementRule", "neighborNotice", "emergencyResponse", "wasteRule",
        "transitionNote", "practicalImpact",
    )
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
        restriction = ward.get("minpakuRestriction")
        if not isinstance(restriction, dict):
            errors.append(f"Ward {ward['slug']} missing minpakuRestriction")
            continue
        for field in restriction_fields:
            if field not in restriction:
                errors.append(f"Ward {ward['slug']} restriction missing {field}")
        if restriction.get("researchStatus") not in {"verified", "partial", "pending"}:
            errors.append(f"Ward {ward['slug']} invalid researchStatus")
        if restriction.get("changeStatus") not in {"stable", "recent-change", "transition"}:
            errors.append(f"Ward {ward['slug']} invalid changeStatus")
        level = ward.get("contentLevel") or ("L3" if ward["slug"] in priority_wards else "L1")
        if level not in {"L1", "L2", "L3", "L4", "L5"}:
            errors.append(f"Ward {ward['slug']} has invalid contentLevel")
        if level in {"L3", "L4"}:
            if restriction.get("researchStatus") != "verified":
                errors.append(f"L3/L4 ward {ward['slug']} is not verified")
            for field in pending_text_fields:
                if not restriction.get(field):
                    errors.append(f"L3/L4 ward {ward['slug']} missing {field}")
            for field in ("verifiedAt", "reviewDue"):
                if not restriction.get(field):
                    errors.append(f"L3/L4 ward {ward['slug']} missing {field}")
            if restriction.get("verifiedAt"):
                date.fromisoformat(restriction["verifiedAt"])
            if restriction.get("reviewDue"):
                restriction_due = date.fromisoformat(restriction["reviewDue"])
                if restriction_due < today:
                        errors.append(f"Ward {ward['name']} restriction review overdue: {restriction_due}")
            if page.exists():
                page_text = page.read_text(encoding="utf-8")
                for heading in ("可运营期间摘要", "学校周边", "管理业者要求", "官方来源"):
                    if heading not in page_text:
                        errors.append(f"L3/L4 ward page {ward['slug']} missing {heading}")
                for source in restriction.get("officialSources", []):
                    if source.get("url") not in page_text:
                        errors.append(f"L3/L4 ward page {ward['slug']} missing source {source.get('url')}")
        elif level == "L2":
            if restriction.get("researchStatus") != "partial":
                errors.append(f"L2 ward {ward['slug']} must be partial")
            for field in pending_text_fields:
                if not restriction.get(field):
                    errors.append(f"L2 ward {ward['slug']} missing {field}")
            for field in ("verifiedAt", "reviewDue"):
                if not restriction.get(field):
                    errors.append(f"L2 ward {ward['slug']} missing {field}")
        elif level == "L1":
            if restriction.get("researchStatus") != "pending":
                errors.append(f"L1 ward {ward['slug']} must remain pending")
            for field in pending_text_fields:
                if restriction.get(field) != "待向管辖窗口确认":
                    errors.append(f"L1 ward {ward['slug']} must mark {field} for confirmation")
            if restriction.get("verifiedAt") is not None or restriction.get("reviewDue") is not None:
                errors.append(f"L1 ward {ward['slug']} must not claim verification dates")
        sources = restriction.get("officialSources")
        if not isinstance(sources, list) or not sources:
            errors.append(f"Ward {ward['slug']} missing officialSources")
        else:
            for source in sources:
                if not source.get("title") or not source.get("url", "").startswith("https://"):
                    errors.append(f"Ward {ward['slug']} has invalid official source")
        if restriction.get("effectiveFrom") is not None:
            date.fromisoformat(restriction["effectiveFrom"])

    sources = load_json(ROOT / "data" / "sources.json")
    source_metadata = load_json(ROOT / "data" / "source-metadata.json")
    metadata_by_id = {item.get("id"): item for item in source_metadata}
    source_ids: set[str] = set()
    source_required = (
        "id", "authority", "title", "url", "grade", "system", "region",
        "documentType", "topics", "relatedPages", "verifiedAt", "status",
    )
    for source in sources:
        for field in source_required:
            if field not in source or source[field] in ("", None):
                errors.append(f"Source {source.get('id', '<unknown>')} missing {field}")
        if source.get("id") in source_ids:
            errors.append(f"Duplicate source id: {source.get('id')}")
        source_ids.add(source.get("id"))
        if source.get("grade") != "A":
            errors.append(f"Source {source.get('id')} must be grade A")
        if source.get("status") not in {"current", "transition", "review-soon"}:
            errors.append(f"Source {source.get('id')} has invalid status")
        if not isinstance(source.get("topics"), list) or not source.get("topics"):
            errors.append(f"Source {source.get('id')} missing topics")
        if not isinstance(source.get("relatedPages"), list) or not source.get("relatedPages"):
            errors.append(f"Source {source.get('id')} missing relatedPages")
        else:
            for related in source["relatedPages"]:
                target = resolve_internal(ROOT / "index.html", related)
                if target is None or not target.exists():
                    errors.append(f"Source {source.get('id')} related page missing: {related}")
        if not source.get("url", "").startswith("https://"):
            errors.append(f"Source {source.get('id')} URL must use HTTPS")
        if source.get("verifiedAt"):
            date.fromisoformat(source["verifiedAt"])
        metadata = metadata_by_id.get(source.get("id"))
        if not metadata:
            errors.append(f"Source {source.get('id')} missing lifecycle metadata")
        else:
            for field in ("sourceType", "summary", "businessImpact", "reviewDue", "confirmationNeeded"):
                if metadata.get(field) in ("", None):
                    errors.append(f"Source metadata {source.get('id')} missing {field}")
            date.fromisoformat(metadata["reviewDue"])

    unknown_metadata = set(metadata_by_id) - source_ids
    for source_id in sorted(unknown_metadata):
        errors.append(f"Source metadata has unknown id: {source_id}")

    sources_page = (ROOT / "resources" / "sources" / "index.html").read_text(encoding="utf-8")
    for marker in ("data-source-authority", "data-source-region", "data-source-system", "data-source-topic", "data-source-list"):
        if marker not in sources_page:
            errors.append(f"Official sources page missing filter {marker}")

    search_entries = load_json(ROOT / "data" / "search-index.json")
    seen_urls: set[str] = set()
    for entry in search_entries:
        if entry["url"] in seen_urls:
            errors.append(f"Duplicate search URL: {entry['url']}")
        seen_urls.add(entry["url"])
        target = resolve_internal(ROOT / "index.html", entry["url"])
        if target is not None and not target.exists():
            errors.append(f"Search index target missing: {entry['url']}")

    core_content_paths = {
        "/industry/", "/properties/", "/roles/", "/channels/", "/revenue/",
        "/communications/", "/maintenance/", "/finance/", "/cases/",
        "/training/", "/trends/", "/regimes/transitions/",
    }
    for path in sorted(core_content_paths - seen_urls):
        errors.append(f"Core industry page missing from search index: {path}")

    sop_paths = {
        "/operations/booking-prearrival/", "/operations/guest-register/",
        "/operations/access-control/", "/operations/cleaning/", "/operations/waste/",
        "/operations/complaints-incidents/", "/operations/equipment-emergency/",
        "/operations/lost-damage/", "/operations/ota-refunds/",
        "/operations/periodic-report/", "/operations/finance-insurance/",
        "/operations/continuity/",
    }
    for path in sorted(sop_paths):
        target = resolve_internal(ROOT / "index.html", path)
        if target is None or not target.exists():
            errors.append(f"Core SOP missing: {path}")
            continue
        sop_text = target.read_text(encoding="utf-8")
        for marker in ("执行字段", "证据", "升级", "禁止"):
            if marker not in sop_text:
                errors.append(f"Core SOP {path} missing {marker}")
        if path not in seen_urls and path != "/operations/complaints-incidents/":
            errors.append(f"Core SOP missing from search index: {path}")

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

    print(f"Checked {len(html_files)} HTML files, {len(wards)} wards, {len(search_entries)} search entries, {len(sources)} sources.")
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
