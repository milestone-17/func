export interface RequestInstanceState {
  /** 错误消息栈 (去重) */
  errMsgStack?: string[];
  [key: string]: unknown;
}
