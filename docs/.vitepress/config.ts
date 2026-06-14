import { defineConfig } from "vitepress";

// Cave docs site — VitePress.
// Live at https://getcaveman.dev/docs (deploy target).
// Sidebar mirrors the WS12 spec section list.

export default defineConfig({
    title: "Cave",
    description:
        "Best-in-class terminal coding agent. Token efficiency under revalidation — see #8. 20+ provider OAuth. MIT.",
    lastUpdated: true,
    cleanUrls: true,
    base: "/docs/",
    sitemap: { hostname: "https://getcaveman.dev" },

    head: [
        ["link", { rel: "icon", href: "/docs/favicon.svg", type: "image/svg+xml" }],
        ["meta", { name: "theme-color", content: "#0d1117" }],
        ["meta", { property: "og:type", content: "website" }],
        ["meta", { property: "og:title", content: "Cave — terminal coding agent" }],
        [
            "meta",
            {
                property: "og:description",
                content:
                    "Token efficiency under revalidation — see #8. 20+ provider OAuth. Plan mode, subagents, MCP, sandbox, hooks. MIT.",
            },
        ],
        ["meta", { property: "og:url", content: "https://getcaveman.dev/docs/" }],
    ],

    themeConfig: {
        siteTitle: "Cave",
        logo: { src: "/logo.svg", alt: "Cave" },

        nav: [
            { text: "Docs", link: "/getting-started/quickstart" },
            { text: "Reference", link: "/reference/slash-commands" },
            { text: "Migration", link: "/migration/from-claude-code" },
            { text: "Comparison", link: "/comparison" },
            { text: "Cookbook", link: "/cookbook" },
            {
                text: "Links",
                items: [
                    { text: "GitHub", link: "https://github.com/JuliusBrussee/caveman-cli" },
                    { text: "Discord", link: "https://discord.gg/cave-cli" },
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
            { icon: "github", link: "https://github.com/JuliusBrussee/caveman-cli" },
            { icon: "discord", link: "https://discord.gg/cave-cli" },
        ],

        footer: {
            message: "MIT Licensed.",
            copyright: "Copyright © 2026 Julius Brussee",
        },

        editLink: {
            pattern:
                "https://github.com/JuliusBrussee/caveman-cli/edit/main/docs/:path",
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
