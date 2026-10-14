import { BACKEND_ERROR_CODE, createFlatRequest, createRequest } from '@sa/axios';
import { useAuthStore } from '@/store/modules/auth';
import { getServiceBaseURL } from '@/utils/service';
import { showErrorMsg } from './shared';
import type { RequestInstanceState } from './type';

const isHttpProxy = import.meta.env.DEV && import.meta.env.VITE_HTTP_PROXY === 'Y';
const { baseURL, otherBaseURL } = getServiceBaseURL(import.meta.env, isHttpProxy);

export const request = createFlatRequest<unknown, unknown, RequestInstanceState>(
  {
    baseURL,
    withCredentials: true,
    headers: {
      'content-type': 'application/json'
    }
  },
  {
    defaultState: {
      errMsgStack: []
    } as RequestInstanceState,
    transform(response: { data: unknown }) {
      // 后端直接返回业务数据（无 { code, msg, data } 包装），不再二次解包
      return response.data;
    },
    isBackendSuccess(response) {
      return true;
    },
    async onBackendFail() {
      return null;
    },
    onError(error) {
      // 401: 会话过期 → 重置登录态跳登录页
      if (error.response?.status === 401) {
        const authStore = useAuthStore();
        authStore.resetStore();
        return;
      }

      let message = error.message;
      const respData = error.response?.data as any;
      if (error.code === BACKEND_ERROR_CODE && typeof respData?.msg === 'string') {
        message = respData.msg;
      } else if (typeof respData?.error === 'string') {
        // 后端错误格式: { error: string }
        message = respData.error;
      }
      showErrorMsg(request.state, message);
    }
  }
);

export const demoRequest = request;
