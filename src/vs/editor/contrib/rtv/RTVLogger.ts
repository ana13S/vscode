/* eslint-disable code-import-patterns */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IRTVLogger } from 'vs/editor/contrib/rtv/RTVInterfaces';

/*
 * Things to log:
 *   - How many requests?
 *   - How often?
 *   - How many fail?
 *   - Attempts to synthesize dependent loops?
 *   - How many examples do they provide?
 */
// TODO Everything is sync right now. We should convert
// it to async calls to minimize any waiting for logging.
export class RTVLogger implements IRTVLogger {
	// States for various things we need to log
	private synthRequestCounter: number = 0;
	private logDir: string;
	private currentFileName: string = 'unknown';
	private readonly logFile: string;

	private now(): number {
		return new Date().getTime();
	}

	private getCurrentFileName() {
		let rs = this._editor.getModel()?.uri.toString();

		if (rs) {
			if (!rs.includes(this.currentFileName)) {
				let start = rs.lastIndexOf('/') + 1;
				let end = rs.length - start - 3;
				this.currentFileName = rs.substr(start, end);
			}
		} else {
			this.currentFileName = 'unknown';
		}

		return this.currentFileName;
	}

	private log(code: string, msg?: string): void {
		let str: string;

		if (msg) {
			msg = msg.replace(/\n/g, '\\n');
			str = `${this.now()},${this.getCurrentFileName()},${code},${msg}`;
		} else {
			str = `${this.now()},${this.getCurrentFileName()},${code}`;
		}

		console.log(str);
		fs.appendFileSync(this.logDir + this.logFile, str + '\n');
	}

	private write(file: string, content: any): void {
		fs.writeFileSync(this.logDir + file, String(content));
	}

	constructor(private readonly _editor: ICodeEditor) {
		// Build output dir name
		let dir = process.env['LOG_DIR'];

		if (!dir) {
			dir = os.tmpdir() + path.sep;
		} else {
			if (!dir.endsWith(path.sep)) {
				dir += path.sep;
			}

			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir);
			}
		}

		// Build an fs-safe date/time:
		let now = new Date();
		dir += 'snippy_log' + '_' +
			(now.getMonth() + 1) + '-' +
			now.getDate() + '_' +
			now.getHours() + '-' +
			now.getMinutes();

		// Don't overwrite existing logs!
		if (fs.existsSync(dir!!)) {
			console.error('Two log dirs created at the exact same time. This should not happen.');
			let counter = 0;
			dir = dir + '_' + counter;
			while (fs.existsSync(dir)) {
				dir = dir.substring(0, dir.length - 1) + counter++;
			}
		}

		this.logDir = dir! + path.sep;
		fs.mkdirSync(this.logDir);
		this.logFile = 'snippy.log';
	}

	public projectionBoxCreated() {
		this.log('projectionBox.created');
	}

	public projectionBoxDestroyed() {
		this.log('projectionBox.destroyed');
	}

	public synthStart(problem: any, examples: number, lineno: number) {
		this.log(`synth.start.${this.synthRequestCounter}.${lineno}.${examples}`);

		this.write(
			`${this.synthRequestCounter}_synth_example.json`,
			JSON.stringify(problem, null, 2));
		this.write(
			`${this.synthRequestCounter}_editor_state.py`,
			this._editor.getModel()?.getLinesContent().join('\n'));

		this.synthRequestCounter++;
	}

	public synthOut(msg: string) {
		if (msg.endsWith('\n')) {
			msg = msg.substr(0, msg.length - 1);
		}

		this.log('synth.stdout', msg);
	}

	public synthErr(msg: string) {
		if (msg.endsWith('\n')) {
			msg = msg.substr(0, msg.length - 1);
		}

		this.log('synth.sterr', msg);
	}

	public synthEnd(exitCode: number, result?: string) {
		if (exitCode === 0) {
			this.log(`synth.end.${this.synthRequestCounter - 1}.${exitCode}`, result);
		} else {
			this.log(`synth.end.${this.synthRequestCounter - 1}.${exitCode}`);
		}
	}

	public projectionBoxFocus(line: string, custom?: boolean) {
		if (custom) {
			this.log('focus.projectionBox.focus.custom', line);
		} else {
			this.log('focus.projectionBox.focus.default', line);
		}
	}

	public projectionBoxUpdateStart(program: string): void {
		this.log('projectionBox.update.start');
	}

	public projectionBoxUpdateEnd(result: string | undefined): void {
		this.log('projectionBox.update.end');
	}

	public projectionBoxExit() {
		this.log('focus.projectionBox.exit');
	}

	public exampleBlur(idx: number, content: string) {
		this.log(`focus.example.${idx}.blur`, content);
	}

	public exampleFocus(idx: number, content: string) {
		this.log(`focus.example.${idx}.focus`, content);
	}

	public exampleChanged(idx: number, was: string, is: string) {
		this.log(`example.${idx}.change`, `${was},${is}`);
	}

	public exampleInclude(idx: number, content: string) {
		this.log(`example.${idx}.include`, content);
	}

	public exampleExclude(idx: number, content: string) {
		this.log(`example.${idx}.exclude`, content);
	}

	public exampleReset() {
		this.log('example.all.reset');
	}

	public imgSummaryStart(lineno: number, variable: string) {
		this.log('img.start',`${lineno},${variable}`);
	}

	public imgSummaryEnd() {
		this.log('img.end');
	}

	public projectionBoxModeChanged(mode: string): void {
		this.log(`projectionBox.mode.${mode}`);
	}

	public showOutputBox(): void {
		this.log(`outputBox.show  (Client pressed Run button)`);
	}

	public hideOutputBox(): void {
		this.log(`outputBox.hide`);
	}
}
