import { Process, IRTVController } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

declare const window: {
	editor: ICodeEditor
};

class IDGenerator {
	private next: number;

	constructor() {
		this.next = 0;
	}

	getId(): number {
		return this.next++;
	}
}

const idGen: IDGenerator = new IDGenerator();

enum ResponseType {
	// Responses related to the running program
	STDOUT = 1,
	STDERR = 2,
	RESULT = 3,
	EXCEPTION = 4,

	// Responses related to the web worker itself
	ERROR = 5,
	LOADED = 6
}

enum RequestType {
	RUNPY = 1,
	IMGSUM = 2
}

class PyodideWorkerResponse {
	constructor(
		public id: number,
		public type: ResponseType,
		public msg: string) {}
}

class RunpyWorkerRequest {
	public type: RequestType;
	constructor(
		public id: number,
		public name: string,
		public content: string) {
			this.type = RequestType.RUNPY;
		}
}

class ImgSumWorkerRequest {
	public type: RequestType = RequestType.IMGSUM;

	constructor(
		public id: number,
		public name: string,
		public content: string,
		public line: number,
		public varname: string
	) {
		this.type = RequestType.IMGSUM;
	}
}

class RunpyProcess implements Process {
	private id: number;

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private output: string = '';

	private killed: boolean = false;

	private eventListener: (this: Worker, event: MessageEvent) => void;

	constructor(program: string) {
		this.id = idGen.getId();

		this.eventListener = (event: MessageEvent) =>
		{
			let msg: PyodideWorkerResponse = event.data;

			if (msg.id !== this.id) {
				return;
			}

			switch (msg.type)
			{
				case ResponseType.RESULT:
					this.result = msg.msg;
					if (this.onResult) {
						this.onResult(this.result);
					}
					break;
				case ResponseType.STDOUT:
					this.output += msg.msg;
					break;
				case ResponseType.STDERR:
				case ResponseType.EXCEPTION:
					this.error += msg.msg;
					break;
				default:
					break;
			}
		};

		pyodideWorker.addEventListener('message', this.eventListener);
		pyodideWorker.postMessage(new RunpyWorkerRequest(this.id, `program_${this.id}.py`, program));
	}

	onStdout(fn: (data: any) => void): void {
		this.onOutput = fn;
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;
	}

	kill() {
		this.killed = true;
		pyodideWorker.removeEventListener('message', this.eventListener);

		if (this.onResult) {
			this.onResult('');
		}
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = (result) => {
			if (this.onOutput) {
				this.onOutput(this.output);
			}

			if (this.onError) {
				this.onError(this.error);
			}

			fn((result && result !== '') ? 0 : null, result);
		};

		if (this.result) {
			this.onResult(this.result);
		} else if (this.killed) {
			this.onResult('');
		}
	}
}

class ImgSummaryProcess implements Process {
	private id: number;

	private onResult?: ((exitCode: any, result?: string) => void) = undefined;
	private onOutput?: ((data: any) => void) = undefined;
	private onError?: ((data: any) => void) = undefined;

	private result?: string = undefined;
	private error: string = '';
	private output: string = '';

	private eventListener: (this: Worker, event: MessageEvent) => void;

	constructor(program: string, line: number, varname: string) {
		this.id = idGen.getId();

		this.eventListener = (event: MessageEvent) =>
		{
			let msg: PyodideWorkerResponse = event.data;

			if (msg.id !== this.id) {
				return;
			}

			switch (msg.type)
			{
				case ResponseType.RESULT:
					this.result = msg.msg;
					if (this.onResult) {
						this.onResult(this.result);
					}
					break;
				case ResponseType.STDOUT:
					this.output += msg.msg;
					if (this.onOutput) {
						this.onOutput(msg.msg);
					}
					break;
				case ResponseType.STDERR:
				case ResponseType.EXCEPTION:
					this.error += msg.msg;
					if (this.onError) {
						this.onError(msg.msg);
					}
					break;
				default:
					break;
			}
		};

		pyodideWorker.addEventListener('message', this.eventListener);
		pyodideWorker.postMessage(new ImgSumWorkerRequest(this.id, `imgsum_${this.id}.py`, program, line, varname));
	}

	onStdout(fn: (data: any) => void): void {
		this.onOutput = fn;

		if (this.output) {
			this.onOutput(this.output);
		}
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;

		if (this.error) {
			this.onError(this.error);
		}
	}

	kill() {
		pyodideWorker.removeEventListener('message', this.eventListener);
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.onResult = (result) => {
			fn((result && result !== '') ? 0 : 1, result);
		};

		if (this.result) {
			this.onResult(this.result);
		}
	}
}

class SynthProcess implements Process {
	onStdout(fn: (data: any) => void): void {
		// TODO
	}

	onStderr(fn: (data: any) => void): void {
		// TODO
	}

	kill() {
		// TODO
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		// TODO
	}
}

function saveProgram(program: string) {
	// We need this for CSRF protection on the server
	const csrfInput = document.getElementById('csrf-parameter') as HTMLInputElement;
	const csrfToken = csrfInput.value;
	const csrfHeaderName = csrfInput.name;

	const headers = new Headers();
	headers.append('Content-Type', 'text/plain;charset=UTF-8');
	headers.append(csrfHeaderName, csrfToken);

	fetch(
		'/save',
		{
			method: 'POST',
			body: program,
			mode: 'same-origin',
			headers: headers
		});
}

export function runProgram(program: string): Process {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new SynthProcess();
	}

	saveProgram(program);

	return new RunpyProcess(program);
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess();
}

export function runImgSummary(program: string, line: number, varname: string) {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new SynthProcess();
	}

	return new ImgSummaryProcess(program, line, varname);
}

export function getLogger(editor: ICodeEditor): RTVLogger {
	return new RTVLogger(editor);
}

// Assuming the server is running on a unix system
export const EOL: string = '\n';

// Start the web worker
const pyodideWorker = new Worker('/pyodide/webworker.js');
let pyodideLoaded = false;

const pyodideWorkerInitListener = (event: MessageEvent) =>
{
	let msg = event.data as PyodideWorkerResponse;

	if (msg.type === ResponseType.LOADED)
	{
		console.log('Pyodide loaded!');
		pyodideLoaded = true;
		pyodideWorker.removeEventListener('message', pyodideWorkerInitListener);

		const program = window.editor.getModel()!!.getLinesContent().join('\n');
		runProgram(program).onExit((_code, _result) =>
		{
			(window.editor.getContribution('editor.contrib.rtv') as IRTVController).runProgram();
			(document.getElementById('spinner') as HTMLInputElement).style.display = 'none';
		});
	}
	else
	{
		console.error('First message from pyodide worker was not a load message!');
		console.error(msg.type);
		console.error(ResponseType.LOADED);
	}
};

pyodideWorker.onerror = console.error;
pyodideWorker.addEventListener('message', pyodideWorkerInitListener);
