export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// メールログイン方式に変更したため、未認証時はホーム画面（/）にリダイレクト
export const getLoginUrl = () => "/";
