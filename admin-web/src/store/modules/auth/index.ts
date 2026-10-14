import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { defineStore } from 'pinia';
import { useLoading } from '@sa/hooks';
import { fetchCheckSession, fetchLogin } from '@/service/api';
import { useRouterPush } from '@/hooks/common/router';
import { localStg } from '@/utils/storage';
import { SetupStoreId } from '@/enum';
import { $t } from '@/locales';
import { useRouteStore } from '../route';
import { useTabStore } from '../tab';

export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const route = useRoute();
  const authStore = useAuthStore();
  const routeStore = useRouteStore();
  const tabStore = useTabStore();
  const { toLogin, redirectFromLogin } = useRouterPush(false);
  const { loading: loginLoading, startLoading, endLoading } = useLoading();

  /** 登录态: 本地标记 + 后端 Cookie 双重确认; 刷新页面后由 initUserInfo 重新探测 */
  const loggedFlag = ref(localStg.get('admin-logged') === '1');

  const userInfo: Api.Auth.UserInfo = reactive({
    userId: '',
    userName: '',
    roles: [],
    buttons: []
  });

  /** is super role in static route */
  const isStaticSuper = computed(() => userInfo.roles.includes('R_SUPER'));

  /** Is login */
  const isLogin = computed(() => loggedFlag.value);

  /** Reset auth store */
  async function resetStore() {
    if (loggedFlag.value) {
      // 尽力通知后端清 Cookie
      import('@/service/api').then(({ fetchLogout }) => fetchLogout()).catch(() => {});
    }
    clearAdminFlag();
    loggedFlag.value = false;
    authStore.$reset();

    if (!route.meta.constant) {
      await toLogin();
    }

    tabStore.cacheTabs();
    routeStore.resetStore();
  }

  function clearAdminFlag() {
    localStg.remove('admin-logged');
    localStg.remove('admin-email');
  }

  async function login(email: string, password: string, redirect = true) {
    startLoading();

    const { error } = await fetchLogin(email, password);

    if (!error) {
      localStg.set('admin-logged', '1');
      localStg.set('admin-email', email);
      loggedFlag.value = true;

      userInfo.userId = email;
      userInfo.userName = email;
      userInfo.roles = ['R_SUPER'];

      await redirectFromLogin(redirect);

      window.$notification?.success({
        title: $t('page.login.common.loginSuccess'),
        message: $t('page.login.common.welcomeBack', { userName: email }),
        duration: 4500
      });
    }

    endLoading();
  }

  /** 会话探测: 刷新页面后调用, 401 时 request 层自动 resetStore */
  async function initUserInfo() {
    if (!loggedFlag.value) return;

    const { error } = await fetchCheckSession();

    if (error) {
      // 401 已由 request 层 resetStore; 其他错误同样登出
      if (error.response?.status !== 401) {
        resetStore();
      }
      return;
    }

    const email = localStg.get('admin-email') || '';
    userInfo.userId = email;
    userInfo.userName = email;
    userInfo.roles = ['R_SUPER'];
  }

  return {
    token: ref(''),
    userInfo,
    isStaticSuper,
    isLogin,
    loginLoading,
    resetStore,
    login,
    initUserInfo
  };
});
