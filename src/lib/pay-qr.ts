/** 收款码配置。 */
import alipayAsset from "@/assets/qr-alipay.jpg.asset.json";
import wechatAsset from "@/assets/qr-wechat.jpg.asset.json";

export const WECHAT_QR: string | null = wechatAsset.url;
export const ALIPAY_QR: string | null = alipayAsset.url;

export const PAY_ACCOUNT_NAME = "陈籽言 (Ziyan Chen)";