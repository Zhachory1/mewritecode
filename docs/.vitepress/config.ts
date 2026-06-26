import { defineConfig } from "vitepress";

// Docs site branding is environment-configurable for downstream distributions.
const siteTitle = process.env.DOCS_SITE_TITLE ?? "Me Write Code";
const siteDescription =
    process.env.DOCS_SITE_DESCRIPTION ??
    "Terminal coding harness with token-saving Caveman Mode. Provider-agnostic, terminal-native, MIT.";
const docsBase = process.env.DOCS_BASE ?? "/docs/";
const docsSiteUrl = process.env.DOCS_SITE_URL ?? "https://zhachory1.github.io/mewritecode";
const githubUrl = process.env.DOCS_GITHUB_URL ?? "https://github.com/Zhachory1/mewritecode";
const discordUrl = process.env.DOCS_DISCORD_URL ?? "https://discord.com/invite/nKXTsAcmbT";
const docsUrl = `${docsSiteUrl.replace(/\/$/, "")}${docsBase}`;

export default defineConfig({
    title: siteTitle,
    description: siteDescription,
    lastUpdated: true,
    cleanUrls: true,
    base: docsBase,
    sitemap: { hostname: docsSiteUrl },

    head: [
        ["link", { rel: "icon", href: "/docs/favicon.svg", type: "image/svg+xml" }],
        ["meta", { name: "theme-color", content: "#0d1117" }],
        ["meta", { property: "og:type", content: "website" }],
        ["meta", { property: "og:title", content: `${siteTitle} — terminal coding agent` }],
        [
            "meta",
            {
                property: "og:description",
                content: siteDescription,
            },
        ],
        ["meta", { property: "og:url", content: docsUrl }],
    ],

    themeConfig: {
        siteTitle,
        logo: { src: "/logo.svg", alt: siteTitle },

        nav: [
            { text: "Docs", link: "/getting-started/quickstart" },
            { text: "Reference", link: "/reference/slash-commands" },
            { text: "Migration", link: "/migration/from-claude-code" },
            { text: "Comparison", link: "/comparison" },
            { text: "Cookbook", link: "/cookbook" },
            {
                text: "Links",
                items: [
                    { text: "GitHub", link: githubUrl },
                    { text: "Discord", link: discordUrl },
                    { text: "llms.txt", link: "/llms.txt" },
                ],
            },
        ],

        sidebar: [
            {
                text: "Getting Started",
                items: [
                    { text: "Quickstart", link: "/getting-started/quickstart" },
                    { text: "Install", link: "/getting-started/installation" },
                    { text: "Auth & Providers", link: "/getting-started/auth" },
                    { text: "Models", link: "/getting-started/models" },
                ],
            },
            {
                text: "Core Concepts",
                items: [
                    { text: "Tools", link: "/reference/tools" },
                    { text: "Slash Commands", link: "/reference/slash-commands" },
                    { text: "Skills", link: "/reference/skills" },
                    { text: "Subagents", link: "/reference/subagents" },
                    { text: "Memory (cavemem)", link: "/reference/memory" },
                    { text: "MCP", link: "/reference/mcp" },
                    { text: "Hooks", link: "/reference/hooks" },
                    { text: "Permissions", link: "/reference/permissions" },
                    { text: "Plan Mode", link: "/reference/plan-mode" },
                    { text: "Daemon", link: "/reference/daemon" },
                    { text: "Recipes", link: "/reference/recipes" },
                ],
            },
            {
                text: "Migration",
                items: [
                    { text: "From Claude Code", link: "/migration/from-claude-code" },
                    { text: "From Codex", link: "/migration/from-codex" },
                    { text: "From Aider", link: "/migration/from-aider" },
                ],
            },
            {
                text: "Recipes & Cookbook",
                items: [
                    { text: "Cookbook", link: "/cookbook" },
                    { text: "Comparison", link: "/comparison" },
                    { text: "Troubleshooting", link: "/troubleshooting" },
                ],
            },
            {
                text: "API",
                items: [{ text: "API Reference", link: "/api" }],
            },
        ],

        socialLinks: [
            { icon: "github", link: githubUrl },
            { icon: "discord", link: discordUrl },
        ],

        footer: {
            message: "MIT Licensed.",
            copyright: "Copyright © 2026 Julius Brussee",
        },

        editLink: {
            pattern: `${githubUrl}/edit/main/docs/:path`,
            text: "Edit this page on GitHub",
        },

        search: {
            // Algolia DocSearch (free for OSS) — credentials applied for separately.
            // Until approved, fall back to local search.
            provider: "local",
        },

        outline: { level: [2, 3] },
    },

    // Per-page "Copy for LLMs" handled by client component in theme/index.ts.
    // The /llms.txt root index lives in /public/llms.txt.
    markdown: {
        lineNumbers: false,
    },
});
