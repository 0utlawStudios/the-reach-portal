declare module "heic-decode" {
  interface HeicDecodeOptions {
    buffer: Buffer | ArrayBuffer | Uint8Array;
  }

  interface HeicDecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  interface HeicDeferredImage {
    width: number;
    height: number;
    decode(): Promise<HeicDecodedImage>;
  }

  type HeicDeferredImages = HeicDeferredImage[] & {
    dispose(): void;
  };

  interface HeicDecode {
    (options: HeicDecodeOptions): Promise<HeicDecodedImage>;
    all(options: HeicDecodeOptions): Promise<HeicDeferredImages>;
  }

  const decode: HeicDecode;
  export default decode;
}
