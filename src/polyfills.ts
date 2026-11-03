// Kleine Polyfills für ältere iPadOS-/Safari-Versionen

// pdf.js benötigt Promise.withResolvers (Safari < 17.4)
const P = Promise as unknown as { withResolvers?: unknown };
if (typeof P.withResolvers !== 'function') {
  P.withResolvers = function withResolvers<T>() {
    let resolve!: (v: T | PromiseLike<T>) => void;
    let reject!: (r?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
