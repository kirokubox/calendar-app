import { Icon } from "./Icon";

interface Props {
  onAdd: () => void;
  onOpenReview: () => void;
  onOpenSettings: () => void;
}

/** カレンダー画面の先頭の「はじめに」：予定・実績・ながら・マーカーが1件もないとき（はじめて開いた人）だけ出す */
export default function WelcomeCard({ onAdd, onOpenReview, onOpenSettings }: Props) {
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
        <li>
          <div className="welcome-row">
            <span className="welcome-no" aria-hidden="true">②</span>
            <span className="welcome-text">終わったら、予定を押して「予定通り」で実績にする</span>
          </div>
        </li>
        <li>
          <button type="button" className="welcome-row" onClick={onOpenReview}>
            <span className="welcome-no" aria-hidden="true">③</span>
            <span className="welcome-text">振り返りで、時間の使い方を見る</span>
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
      </ol>
      <p className="welcome-note">
        実績を付けずに、予定だけのカレンダーとしても使えます。Googleカレンダーの予定やバックアップは、設定から読み込めます。
        <button type="button" className="text-btn" onClick={onOpenSettings}>設定を開く</button>
      </p>
    </section>
  );
}
