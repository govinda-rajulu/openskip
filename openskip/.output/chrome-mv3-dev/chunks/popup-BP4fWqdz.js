//#region \0vite/modulepreload-polyfill.js
(function polyfill() {
	const relList = document.createElement("link").relList;
	if (relList && relList.supports && relList.supports("modulepreload")) return;
	for (const link of document.querySelectorAll("link[rel=\"modulepreload\"]")) processPreload(link);
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") continue;
			for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
		}
	}).observe(document, {
		childList: true,
		subtree: true
	});
	function getFetchOpts(link) {
		const fetchOpts = {};
		if (link.integrity) fetchOpts.integrity = link.integrity;
		if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
		if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
		else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
		else fetchOpts.credentials = "same-origin";
		return fetchOpts;
	}
	function processPreload(link) {
		if (link.ep) return;
		link.ep = true;
		const fetchOpts = getFetchOpts(link);
		fetch(link.href, fetchOpts);
	}
})();
//#endregion
//#region node_modules/wxt/dist/virtual/reload-html.mjs
function print(method, ...args) {
	if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
	else method("[wxt]", ...args);
}
/** Wrapper around `console` with a "[wxt]" prefix */
var logger = {
	debug: (...args) => print(console.debug, ...args),
	log: (...args) => print(console.log, ...args),
	warn: (...args) => print(console.warn, ...args),
	error: (...args) => print(console.error, ...args)
};
var ws;
/** Connect to the websocket and listen for messages. */
function getDevServerWebSocket() {
	if (ws == null) {
		const serverUrl = "ws://localhost:3000";
		logger.debug("Connecting to dev server @", serverUrl);
		ws = new WebSocket(serverUrl, "vite-hmr");
		ws.addWxtEventListener = ws.addEventListener.bind(ws);
		ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
			type: "custom",
			event,
			payload
		}));
		ws.addEventListener("open", () => {
			logger.debug("Connected to dev server");
		});
		ws.addEventListener("close", () => {
			logger.debug("Disconnected from dev server");
		});
		ws.addEventListener("error", (event) => {
			logger.error("Failed to connect to dev server", event);
		});
		ws.addEventListener("message", (e) => {
			try {
				const message = JSON.parse(e.data);
				if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
			} catch (err) {
				logger.error("Failed to handle message", err);
			}
		});
	}
	return ws;
}
try {
	getDevServerWebSocket().addWxtEventListener("wxt:reload-page", (event) => {
		if (event.detail === location.pathname.substring(1)) location.reload();
	});
} catch (err) {
	logger.error("Failed to setup web socket connection with dev server", err);
}
//#endregion

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9wdXAtQlA0ZldxZHouanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiLi4vLi4vLi4vbm9kZV9tb2R1bGVzL3d4dC9kaXN0L3ZpcnR1YWwvcmVsb2FkLWh0bWwubWpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvbG9nZ2VyLnRzXG5mdW5jdGlvbiBwcmludChtZXRob2QsIC4uLmFyZ3MpIHtcblx0aWYgKGltcG9ydC5tZXRhLmVudi5NT0RFID09PSBcInByb2R1Y3Rpb25cIikgcmV0dXJuO1xuXHRpZiAodHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIpIG1ldGhvZChgW3d4dF0gJHthcmdzLnNoaWZ0KCl9YCwgLi4uYXJncyk7XG5cdGVsc2UgbWV0aG9kKFwiW3d4dF1cIiwgLi4uYXJncyk7XG59XG4vKiogV3JhcHBlciBhcm91bmQgYGNvbnNvbGVgIHdpdGggYSBcIlt3eHRdXCIgcHJlZml4ICovXG5jb25zdCBsb2dnZXIgPSB7XG5cdGRlYnVnOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5kZWJ1ZywgLi4uYXJncyksXG5cdGxvZzogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUubG9nLCAuLi5hcmdzKSxcblx0d2FybjogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUud2FybiwgLi4uYXJncyksXG5cdGVycm9yOiAoLi4uYXJncykgPT4gcHJpbnQoY29uc29sZS5lcnJvciwgLi4uYXJncylcbn07XG4vLyNlbmRyZWdpb25cbi8vI3JlZ2lvbiBzcmMvdXRpbHMvaW50ZXJuYWwvZGV2LXNlcnZlci13ZWJzb2NrZXQudHNcbmxldCB3cztcbi8qKiBDb25uZWN0IHRvIHRoZSB3ZWJzb2NrZXQgYW5kIGxpc3RlbiBmb3IgbWVzc2FnZXMuICovXG5mdW5jdGlvbiBnZXREZXZTZXJ2ZXJXZWJTb2NrZXQoKSB7XG5cdGlmIChpbXBvcnQubWV0YS5lbnYuQ09NTUFORCAhPT0gXCJzZXJ2ZVwiKSB0aHJvdyBFcnJvcihcIk11c3QgYmUgcnVubmluZyBXWFQgZGV2IGNvbW1hbmQgdG8gY29ubmVjdCB0byBjYWxsIGdldERldlNlcnZlcldlYlNvY2tldCgpXCIpO1xuXHRpZiAod3MgPT0gbnVsbCkge1xuXHRcdGNvbnN0IHNlcnZlclVybCA9IF9fREVWX1NFUlZFUl9PUklHSU5fXztcblx0XHRsb2dnZXIuZGVidWcoXCJDb25uZWN0aW5nIHRvIGRldiBzZXJ2ZXIgQFwiLCBzZXJ2ZXJVcmwpO1xuXHRcdHdzID0gbmV3IFdlYlNvY2tldChzZXJ2ZXJVcmwsIFwidml0ZS1obXJcIik7XG5cdFx0d3MuYWRkV3h0RXZlbnRMaXN0ZW5lciA9IHdzLmFkZEV2ZW50TGlzdGVuZXIuYmluZCh3cyk7XG5cdFx0d3Muc2VuZEN1c3RvbSA9IChldmVudCwgcGF5bG9hZCkgPT4gd3M/LnNlbmQoSlNPTi5zdHJpbmdpZnkoe1xuXHRcdFx0dHlwZTogXCJjdXN0b21cIixcblx0XHRcdGV2ZW50LFxuXHRcdFx0cGF5bG9hZFxuXHRcdH0pKTtcblx0XHR3cy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCAoKSA9PiB7XG5cdFx0XHRsb2dnZXIuZGVidWcoXCJDb25uZWN0ZWQgdG8gZGV2IHNlcnZlclwiKTtcblx0XHR9KTtcblx0XHR3cy5hZGRFdmVudExpc3RlbmVyKFwiY2xvc2VcIiwgKCkgPT4ge1xuXHRcdFx0bG9nZ2VyLmRlYnVnKFwiRGlzY29ubmVjdGVkIGZyb20gZGV2IHNlcnZlclwiKTtcblx0XHR9KTtcblx0XHR3cy5hZGRFdmVudExpc3RlbmVyKFwiZXJyb3JcIiwgKGV2ZW50KSA9PiB7XG5cdFx0XHRsb2dnZXIuZXJyb3IoXCJGYWlsZWQgdG8gY29ubmVjdCB0byBkZXYgc2VydmVyXCIsIGV2ZW50KTtcblx0XHR9KTtcblx0XHR3cy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCAoZSkgPT4ge1xuXHRcdFx0dHJ5IHtcblx0XHRcdFx0Y29uc3QgbWVzc2FnZSA9IEpTT04ucGFyc2UoZS5kYXRhKTtcblx0XHRcdFx0aWYgKG1lc3NhZ2UudHlwZSA9PT0gXCJjdXN0b21cIikgd3M/LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KG1lc3NhZ2UuZXZlbnQsIHsgZGV0YWlsOiBtZXNzYWdlLmRhdGEgfSkpO1xuXHRcdFx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0XHRcdGxvZ2dlci5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgbWVzc2FnZVwiLCBlcnIpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHR9XG5cdHJldHVybiB3cztcbn1cbi8vI2VuZHJlZ2lvblxuLy8jcmVnaW9uIHNyYy92aXJ0dWFsL3JlbG9hZC1odG1sLnRzXG5pZiAoaW1wb3J0Lm1ldGEuZW52LkNPTU1BTkQgPT09IFwic2VydmVcIikgdHJ5IHtcblx0Z2V0RGV2U2VydmVyV2ViU29ja2V0KCkuYWRkV3h0RXZlbnRMaXN0ZW5lcihcInd4dDpyZWxvYWQtcGFnZVwiLCAoZXZlbnQpID0+IHtcblx0XHRpZiAoZXZlbnQuZGV0YWlsID09PSBsb2NhdGlvbi5wYXRobmFtZS5zdWJzdHJpbmcoMSkpIGxvY2F0aW9uLnJlbG9hZCgpO1xuXHR9KTtcbn0gY2F0Y2ggKGVycikge1xuXHRsb2dnZXIuZXJyb3IoXCJGYWlsZWQgdG8gc2V0dXAgd2ViIHNvY2tldCBjb25uZWN0aW9uIHdpdGggZGV2IHNlcnZlclwiLCBlcnIpO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQge307XG4iXSwieF9nb29nbGVfaWdub3JlTGlzdCI6WzBdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxTQUFTLE1BQU0sUUFBUSxHQUFHLE1BQU07Q0FFL0IsSUFBSSxPQUFPLEtBQUssT0FBTyxVQUFVLE9BQU8sU0FBUyxLQUFLLE1BQU0sS0FBSyxHQUFHLElBQUk7TUFDbkUsT0FBTyxTQUFTLEdBQUcsSUFBSTtBQUM3Qjs7QUFFQSxJQUFNLFNBQVM7Q0FDZCxRQUFRLEdBQUcsU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7Q0FDaEQsTUFBTSxHQUFHLFNBQVMsTUFBTSxRQUFRLEtBQUssR0FBRyxJQUFJO0NBQzVDLE9BQU8sR0FBRyxTQUFTLE1BQU0sUUFBUSxNQUFNLEdBQUcsSUFBSTtDQUM5QyxRQUFRLEdBQUcsU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7QUFDakQ7QUFHQSxJQUFJOztBQUVKLFNBQVMsd0JBQXdCO0NBRWhDLElBQUksTUFBTSxNQUFNO0VBQ2YsTUFBTSxZQUFBO0VBQ04sT0FBTyxNQUFNLDhCQUE4QixTQUFTO0VBQ3BELEtBQUssSUFBSSxVQUFVLFdBQVcsVUFBVTtFQUN4QyxHQUFHLHNCQUFzQixHQUFHLGlCQUFpQixLQUFLLEVBQUU7RUFDcEQsR0FBRyxjQUFjLE9BQU8sWUFBWSxJQUFJLEtBQUssS0FBSyxVQUFVO0dBQzNELE1BQU07R0FDTjtHQUNBO0VBQ0QsQ0FBQyxDQUFDO0VBQ0YsR0FBRyxpQkFBaUIsY0FBYztHQUNqQyxPQUFPLE1BQU0seUJBQXlCO0VBQ3ZDLENBQUM7RUFDRCxHQUFHLGlCQUFpQixlQUFlO0dBQ2xDLE9BQU8sTUFBTSw4QkFBOEI7RUFDNUMsQ0FBQztFQUNELEdBQUcsaUJBQWlCLFVBQVUsVUFBVTtHQUN2QyxPQUFPLE1BQU0sbUNBQW1DLEtBQUs7RUFDdEQsQ0FBQztFQUNELEdBQUcsaUJBQWlCLFlBQVksTUFBTTtHQUNyQyxJQUFJO0lBQ0gsTUFBTSxVQUFVLEtBQUssTUFBTSxFQUFFLElBQUk7SUFDakMsSUFBSSxRQUFRLFNBQVMsVUFBVSxJQUFJLGNBQWMsSUFBSSxZQUFZLFFBQVEsT0FBTyxFQUFFLFFBQVEsUUFBUSxLQUFLLENBQUMsQ0FBQztHQUMxRyxTQUFTLEtBQUs7SUFDYixPQUFPLE1BQU0sNEJBQTRCLEdBQUc7R0FDN0M7RUFDRCxDQUFDO0NBQ0Y7Q0FDQSxPQUFPO0FBQ1I7QUFHeUMsSUFBSTtDQUM1QyxzQkFBc0IsRUFBRSxvQkFBb0Isb0JBQW9CLFVBQVU7RUFDekUsSUFBSSxNQUFNLFdBQVcsU0FBUyxTQUFTLFVBQVUsQ0FBQyxHQUFHLFNBQVMsT0FBTztDQUN0RSxDQUFDO0FBQ0YsU0FBUyxLQUFLO0NBQ2IsT0FBTyxNQUFNLHlEQUF5RCxHQUFHO0FBQzFFIn0=