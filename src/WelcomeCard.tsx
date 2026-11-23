import { Icon } from "./Icon";

interface Props {
  onAdd: () => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
  /** 予定だけで使う設定のとき、実績の手順を出さない */
  planOnly?: boolean;
}

/** カレンダー画面の先頭の「はじめに」：予定・実績・ながら・マーカーが1件もないとき（はじめて開いた人）だけ出す */
export default function WelcomeCard({ onAdd, onOpenReview, onOpenSettings, planOnly = false }: Props) {
  return (
    <section className="welcome-card" aria-label="はじめに">
      <h2 className="welcome-title">はじめに</h2>
      <ol className="welcome-steps">
        <li>
          <button type="button" className="welcome-row" onClick={onAdd}>
            <span className="welcome-no" aria-hidden="true">①</span>
            <span className="welcome-text">右下の＋から、予定を入れる</span>
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
        {!planOnly && <li>
          <div className="welcome-row">
            <span className="welcome-no" aria-hidden="true">②</span>
            <span className="welcome-text">終わったら、予定を押して「予定通り」で実績にする</span>
          </div>
        </li>}
        <li>
          <button type="button" className="welcome-row" onClick={onOpenReview}>
            <span className="welcome-no" aria-hidden="true">{planOnly ? "②" : "③"}</span>
            <span className="welcome-text">{planOnly ? "振り返りで、予定の入り方を見る" : "振り返りで、時間の使い方を見る"}</span>
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
      </ol>
      {planOnly ? (
        <p className="welcome-note">
          予定だけのカレンダーとして使っています。Googleカレンダーの予定やバックアップは、設定から読み込めます。
          <button type="button" className="text-btn" onClick={onOpenSettings}>設定を開く</button>
        </p>
      ) : (
        <p className="welcome-note">
          実績を付けずに、予定だけのカレンダーとしても使えます。Googleカレンダーの予定やバックアップは、設定から読み込めます。
          <button type="button" className="text-btn" onClick={onOpenSettings}>「予定だけで使う」を設定</button>
        </p>
      )}
    </section>
  );
}
