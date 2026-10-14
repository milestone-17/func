import { request } from '../request';

/** get constant routes (static mode: not actually called) */
export function fetchGetConstantRoutes() {
  return request<Api.Route.MenuRoute[]>({ url: '/api/admin/panel/constant-routes', method: 'get' });
}

/** get user routes (static mode: not actually called) */
export function fetchGetUserRoutes() {
  return request<{ routes: Api.Route.MenuRoute[]; home: import('@elegant-router/types').RouteKey }>({
    url: '/api/admin/panel/user-routes',
    method: 'get'
  });
}

/** whether the route is exist (static mode: not actually called) */
export function fetchIsRouteExist(routeName: string) {
  return request<boolean>({ url: '/api/admin/panel/route-exist', method: 'post', data: { routeName } });
}
