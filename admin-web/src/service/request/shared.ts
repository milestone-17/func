import type { RequestInstanceState } from './type';

export function showErrorMsg(state: RequestInstanceState, message: string) {
  if (!state.errMsgStack) {
    state.errMsgStack = [];
  }

  const stack: string[] = state.errMsgStack;

  if (stack.includes(message)) return;

  stack.push(message);

  window.$message?.error({
    message,
    onClose: () => {
      state.errMsgStack = (state.errMsgStack as string[]).filter(msg => msg !== message);

      setTimeout(() => {
        state.errMsgStack = [];
      }, 5000);
    }
  });
}
