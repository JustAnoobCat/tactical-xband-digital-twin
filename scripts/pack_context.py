#!/usr/bin/env python3
"""
scripts/pack_context.py - Codebase Context Bundler for LLMs
Tactical X-Band Air-to-Ground Network Digital Twin

Packs all source files, configurations, and core documentation into a single
structured markdown / XML context file ready for LLM consumption.
"""

import argparse
import os
import sys
from pathlib import Path

# Files to always ignore
IGNORE_DIRS = {
    "node_modules",
    ".git",
    "dist",
    "benchmark_results/generated",
    ".gemini",
    "__pycache__",
    ".pytest_cache",
    ".vscode",
    "brain",
}

IGNORE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bin", ".npy", ".hgt",
    ".tar", ".gz", ".zip", ".map", ".lock"
}

# Key documentation files
DOC_FILES = [
    "docs/PHASE_0_BASELINE.md",
    "M0_IMPLEMENTATION_NOTES.md",
    "METRICS_PATCH_NOTES.md",
    "benchmark_results/BENCHMARK_DOSSIER.md",
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "requirements.txt",
    "electron/main.cjs",
]

def should_ignore(path: Path) -> bool:
    for part in path.parts:
        if part in IGNORE_DIRS or part.startswith("."):
            return True
    if path.suffix.lower() in IGNORE_EXTENSIONS:
        return True
    if "quarantine" in str(path):
        return True
    return False

def collect_files(repo_root: Path, include_tests: bool = True, include_html: bool = True):
    collected = []
    
    # 1. Config & Documentation files
    for rel_path in DOC_FILES:
        p = repo_root / rel_path
        if p.is_file():
            collected.append(p)

    # 2. Source directories
    search_dirs = [
        repo_root / "src" / "core",
        repo_root / "src" / "shared",
        repo_root / "src" / "worker",
        repo_root / "src" / "ui",
        repo_root / "core",
        repo_root / "server",
        repo_root / "scripts",
    ]

    if include_tests:
        search_dirs.append(repo_root / "src" / "tests")
        search_dirs.append(repo_root / "tests")

    for sdir in search_dirs:
        if not sdir.exists():
            continue
        for root, dirs, files in os.walk(sdir):
            for f in sorted(files):
                p = Path(root) / f
                if not should_ignore(p):
                    collected.append(p)

    if include_html:
        index_html = repo_root / "index.html"
        if index_html.is_file():
            collected.append(index_html)
        css_theme = repo_root / "frontend" / "c2-console-theme.css"
        if css_theme.is_file():
            collected.append(css_theme)

    # Deduplicate while preserving order
    seen = set()
    deduped = []
    for p in collected:
        resolved = p.resolve()
        if resolved not in seen:
            seen.add(resolved)
            deduped.append(p)
            
    return deduped

def main():
    parser = argparse.ArgumentParser(description="Pack codebase context for LLMs.")
    parser.add_argument("--out", "-o", default="CODEBASE_FULL_CONTEXT.md", help="Output file path")
    parser.add_argument("--no-tests", action="store_true", help="Exclude test files")
    parser.add_argument("--no-html", action="store_true", help="Exclude monolithic index.html")
    parser.add_argument("--core-only", action="store_true", help="Only pack core simulation & shared files")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    out_path = repo_root / args.out

    include_tests = not args.no_tests and not args.core_only
    include_html = not args.no_html and not args.core_only

    if args.core_only:
        files = [
            repo_root / rel for rel in DOC_FILES if (repo_root / rel).is_file()
        ]
        for sdir in [repo_root / "src" / "core", repo_root / "src" / "shared", repo_root / "src" / "worker", repo_root / "core"]:
            for root, _, fs in os.walk(sdir):
                for f in sorted(fs):
                    p = Path(root) / f
                    if not should_ignore(p):
                        files.append(p)
    else:
        files = collect_files(repo_root, include_tests=include_tests, include_html=include_html)

    print(f"Collecting files from {repo_root}...")
    print(f"Found {len(files)} files to pack.")

    total_bytes = 0
    total_lines = 0

    with open(out_path, "w", encoding="utf-8") as out:
        out.write("# Tactical X-Band Air-to-Ground Digital Twin — Full Codebase Context\n\n")
        out.write("This file is an authoritative, consolidated codebase context bundle prepared for LLMs.\n")
        out.write("It includes full system specifications, file manifests, and verbatim source code.\n\n")
        out.write("## Table of Packed Files\n\n")
        out.write("| Path | Lines | Size (Bytes) |\n")
        out.write("| :--- | :--- | :--- |\n")

        file_contents = []
        for p in files:
            rel_path = p.relative_to(repo_root).as_posix()
            try:
                content = p.read_text(encoding="utf-8", errors="replace")
                lines = len(content.splitlines())
                b_size = len(content.encode("utf-8"))
                total_lines += lines
                total_bytes += b_size
                out.write(f"| `{rel_path}` | {lines:,} | {b_size:,} |\n")
                file_contents.append((rel_path, content, lines, b_size))
            except Exception as e:
                print(f"Error reading {rel_path}: {e}")

        out.write(f"\n**Total Files**: {len(file_contents)} | **Total Lines**: {total_lines:,} | **Total Bytes**: {total_bytes:,} (~{total_bytes // 4:,} tokens)\n\n")
        out.write("---\n\n")

        out.write("## Source Code Files\n\n")
        for rel_path, content, lines, b_size in file_contents:
            ext = Path(rel_path).suffix.lstrip(".")
            lang = ext
            if ext in ["ts", "tsx"]:
                lang = "typescript"
            elif ext in ["js", "mjs", "cjs"]:
                lang = "javascript"
            elif ext == "py":
                lang = "python"
            elif ext in ["json"]:
                lang = "json"
            elif ext in ["html"]:
                lang = "html"
            elif ext in ["css"]:
                lang = "css"
            elif ext in ["md"]:
                lang = "markdown"

            out.write(f"### File: `{rel_path}` ({lines:,} lines, {b_size:,} bytes)\n\n")
            out.write(f"```{lang}\n")
            out.write(content)
            if not content.endswith("\n"):
                out.write("\n")
            out.write("```\n\n")

    print(f"Successfully generated {out_path.name}")
    print(f"Files: {len(file_contents)}, Lines: {total_lines:,}, Size: {total_bytes:,} bytes (~{total_bytes // 4:,} est. tokens)")

if __name__ == "__main__":
    main()
