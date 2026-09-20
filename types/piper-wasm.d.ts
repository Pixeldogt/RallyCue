declare module '@diffusionstudio/piper-wasm' {
  type PiperPhonemizeModule = {
    callMain: (arguments_: string[]) => number;
  };

  type PiperPhonemizeOptions = {
    print: (data: string) => void;
    printErr: (message: string) => void;
    locateFile: (url: string) => string;
  };

  const createPiperPhonemize: (
    options: PiperPhonemizeOptions,
  ) => Promise<PiperPhonemizeModule>;

  export default createPiperPhonemize;
}
