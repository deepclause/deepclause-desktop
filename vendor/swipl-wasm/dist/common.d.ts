/// <reference types="emscripten" />

type CallOptions = {
  /**
   * Module in which to call Goal.
   */
  module?: string;
  /**
   * Call as yieldable.
   */
  async?: boolean;
};

/**
 * Query interface for opening new queries.
 */
type Query = {
  /**
   * Fetches the next solution.
   */
  next(): unknown;
  /**
   * Runs the query. If there is a solution then returns it.
   * Closes the query.
   */
  once(): unknown;
};

/**
 * Prolog-JavaScript interface of the Prolog instance.
 */
type Prolog = {
  /**
   * Call a Prolog goal.  This function deals with munknown variations to
   * call Prolog.
   */
  call(goal: string, opts?: CallOptions): unknown;

  /**
   * Run a possibly long running goal and process its answers.
   *
   * @param goal Goal to run.
   * @param input Goal input.
   * @param callback Optional callback to process.
   * @return A promise that is resolved on completion and rejected on
   * a Prolog exception.
   */
  forEach(
    goal: string,
    input?: unknown,
    callback?: (prolog: Prolog, answer: unknown) => void
  ): Promise<unknown>;

  /**
   * Calls the goal while binding input arguments.
   *
   * @param goal Goal to run.
   * @param input Input variable bindings.
   */
  query(goal: string, input?: Record<string, unknown>): Query;
};

/**
 * SWI-Prolog instance.
 */
type SWIPLModule = {
  /**
   * Emscripten emulated file system interface.
   */
  FS: typeof FS;
  /**
   * Prolog interface.
   */
  prolog: Prolog;
};

declare namespace initSWIPL {
  export { SWIPLModule, Prolog, Query };
}

/**
 * Factory function that creates a SWI-Prolog instance.
 */
declare function initSWIPL(
  options?: Partial<EmscriptenModule>
): Promise<SWIPLModule>;

export = initSWIPL;
