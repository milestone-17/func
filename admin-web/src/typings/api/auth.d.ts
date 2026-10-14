declare namespace Api {
  /**
   * namespace Auth
   *
   * backend api module: "admin auth"
   */
  namespace Auth {
    interface UserInfo {
      userId: string;
      userName: string;
      roles: string[];
      buttons: string[];
    }
  }
}
