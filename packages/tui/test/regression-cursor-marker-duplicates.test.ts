import assert from "node:assert";
import { describe, it } from "node:test";
import { CURSOR_MARKER } from "../src/tui.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { sliceByColumn, visibleWidth } from "../src/utils.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class CursorTestTui extends TuiMainScreen {
	extract(lines: string[], height: number) {
		return this.extractCursorPosition(lines, height);
	}
}

class RecordingTerminal extends VirtualTerminal {
	writes: string[] = [];

	override write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}
}

// #9257 (related #9332): selection slicing duplicated cursor markers, which leaked into terminal output.
describe("duplicate cursor markers", () => {
	it("keeps the marker only in the slice containing its original column", () => {
		for (const prefix of ["ab", "中"]) {
			const line = `${prefix}${CURSOR_MARKER}cdefghij`;
			const slices = [
				sliceByColumn(line, 0, 4, true),
				sliceByColumn(line, 4, 2, true),
				sliceByColumn(line, 6, 4, true),
			];
			assert.deepStrictEqual(slices, [`${prefix}${CURSOR_MARKER}cd`, "ef", "ghij"]);
			assert.strictEqual(visibleWidth(slices.join("")), 10);
		}
	});

	it("preserves inherited color and hyperlinks, and a marker at the slice start", () => {
		const style = "\x1b[31m\x1b]8;;https://example.com\x07";
		const line = `${style}abcd${CURSOR_MARKER}efgh`;
		assert.strictEqual(sliceByColumn(line, 4, 2, true), `${style}${CURSOR_MARKER}ef`);
		assert.strictEqual(sliceByColumn(line, 6, 2, true), `${style}gh`);
	});

	it("removes all markers while keeping the bottommost visible cursor's first position", () => {
		const tui = new CursorTestTui(new VirtualTerminal());
		const lines = [`old${CURSOR_MARKER}`, `${CURSOR_MARKER}upper`, `中${CURSOR_MARKER}ab${CURSOR_MARKER}cd`];
		assert.deepStrictEqual(tui.extract(lines, 2), { row: 2, col: 2 });
		assert.deepStrictEqual(lines, ["old", "upper", "中abcd"]);
	});

	it("does not position the cursor from an offscreen marker", () => {
		const tui = new CursorTestTui(new VirtualTerminal());
		const lines = [`old${CURSOR_MARKER}`, "visible"];
		assert.strictEqual(tui.extract(lines, 1), null);
		assert.deepStrictEqual(lines, ["old", "visible"]);
	});

	it("never writes a raw cursor marker while dragging across the caret's row", async () => {
		const terminal = new RecordingTerminal(20, 1);
		const tui = new TuiAltScreen(terminal, false, undefined, { copyOnSelect: false });
		tui.addChild({
			render: () => [`ab${CURSOR_MARKER}cdefghij`],
			invalidate: () => {},
		});
		tui.start();
		try {
			await terminal.waitForRender();
			terminal.writes = [];
			terminal.sendInput("\x1b[<0;5;1M");
			terminal.sendInput("\x1b[<32;7;1M");
			await terminal.waitForRender();
			const output = terminal.writes.join("");
			assert.ok(output.includes("\x1b[7m"), "the test must actually highlight a selection");
			assert.ok(!output.includes(CURSOR_MARKER), "internal markers must never reach the terminal");
		} finally {
			tui.stop();
		}
	});
});
