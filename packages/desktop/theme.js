(() => {
	try {
		const theme = localStorage.getItem("mewrite.desktop.theme");
		if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
	} catch { /* System appearance remains the safe default. */ }
})();
