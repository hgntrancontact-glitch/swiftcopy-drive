/* ══════════════ DEMO UI SCRIPT (static placeholder data, no backend yet) ══════════════ */
let initialReviews = [
    { email: "tranthimai.work@gmail.com", stars: 5, comment: "Sếp giao cho cái Drive 80GB tài liệu đào tạo, copy xong trong lúc pha cà phê. Quá nhanh!" },
    { email: "phamquoc.dev@outlook.com", stars: 4, comment: "Giao diện dễ dùng, có bước kiểm tra trước nên không sợ copy nhầm folder bị khoá quyền." },
    { email: "lethihuong88@gmail.com", stars: 5, comment: "Dùng để gom tài liệu cho cả team marketing, tiết kiệm cả buổi chiều không phải tải lên tải xuống thủ công." },
    { email: "dangkhoa.media@gmail.com", stars: 5, comment: "Mất mạng giữa chừng mà vẫn tự tiếp tục đúng chỗ dừng, không lo phải làm lại từ đầu." },
    { email: "minhanh.studio@yahoo.com", stars: 4, comment: "Sản phẩm tốt, mong sớm có thêm tính năng đa ngôn ngữ." },
    { email: "hgntran.contact@gmail.com", stars: 5, comment: "Công cụ copy chạy nhanh khủng khiếp, giao diện tối giản chuẩn chỉ!" },
    { email: "nguyenvana1994@gmail.com", stars: 5, comment: "Đã test thử copy folder dữ liệu khóa học 200GB mất chưa tới 3 phút." },
    { email: "designshare.pro@hotmail.com", stars: 4, comment: "Rất mượt, tính năng tự động tiếp tục khi mất mạng hoạt động xuất sắc." }
];

const adminFaqData = [
    { q: `Sử dụng Copy Drive trên Web có an toàn và bảo mật dữ liệu không? Nó hoạt động như thế nào?`, a: `Cơ chế Copy Drive khi dùng SwiftCopy.Drive luôn an toàn vì công cụ chạy ngay trên trình duyệt, chúng tôi sử dụng Google Drive API chính thống. Còn việc sao chép nội dung file diễn ra hoàn toàn trên hạ tầng của Google, không tải về hay đi qua máy tính/trình duyệt của bạn, cũng không qua bất kỳ máy chủ trung gian nào của SwiftCopy.Drive. Vì vậy không ai, kể cả đội ngũ vận hành web cũng không thể xem hoặc lưu lại được nội dung file của bạn. File gốc không bị xoá hay chỉnh sửa trong suốt quá trình sao chép. Bạn có thể thu hồi quyền truy cập bất cứ lúc nào trong chính tài khoản Google của mình.` },
    { q: `Mua một lần dùng được bao lâu?`, a: `Trọn đời — thanh toán 1 lần duy nhất, không phí gia hạn, không giới hạn thời gian sử dụng.` },
    { q: `Có giới hạn số thư mục/dung lượng (GB) không?`, a: `Bản thân công cụ không giới hạn số thư mục hay dung lượng GB khi thực hiện copy Drive. Giới hạn duy nhất đến từ dung lượng GB hiện có trong Google Drive của bạn. Hãy kiểm tra trước dung lượng GB của Drive bạn, và đối chiếu với dung lượng GB của Drive nguồn (tức Drive gốc) — bạn có thể kiểm tra trực tiếp trên SwiftCopy.Drive. Nếu không đủ, bạn có thể chọn trước những thư mục quan trọng để copy trước. Đây là giải pháp nhanh mà SwiftCopy.Drive làm được để bạn vẫn có thể sao chép trước các thư mục cần thiết.` },
    { q: `Tôi có thể chọn lẻ thư mục/file để copy không?`, a: `Có. Bạn không cần copy toàn bộ Drive — có thể chọn đúng những thư mục hoặc file cụ thể thông qua danh sách chọn lọc của SwiftCopy.Drive trước khi nhấn sao chép.` },
    { q: `Tại sao nên dùng SwiftCopy.Drive để sao chép Drive thay vì cách thông thường?`, a: `Giúp bạn sao chép thẳng thư mục được người khác chia sẻ vào Drive do bạn quản lý một cách nhanh chóng — không cần tải về máy rồi tải ngược lên Drive như cách cũ vốn tốn rất nhiều thời gian. Có sẵn bước "Kiểm tra trước" khi sao chép, để biết Drive nguồn có copy được hay đang bị khoá quyền, giúp bạn xử lý trước khi sao chép. Hệ thống còn đếm dung lượng GB của Drive nguồn trước khi bạn sao chép, giúp tránh tình trạng kẹt do vượt giới hạn dung lượng Drive của bạn (nếu) — dù bạn đã mua thêm dung lượng GB từ Google rồi hoặc chưa, hệ thống cũng đều cho bạn biết trước.` },
    { q: `Đang sao chép nếu mất mạng thì sao?`, a: `Tiến trình tự động lưu lại. Khi có mạng (hoặc mở trình duyệt) trở lại, hệ thống sẽ phát hiện được phiên sao chép dang dở và cho tiếp tục đúng chỗ đã dừng — những mục đã sao chép rồi sẽ tự động được bỏ qua, bạn chỉ cần nhấn tiếp tục, không cần chạy lại từ đầu.` },
    { q: `Tốc độ sao chép nhanh cỡ nào?`, a: `Ví dụ minh hoạ: một thư mục Drive nặng 50GB với khoảng 5.000 file.<br><br>Cách thủ công (tải về máy rồi tải lên lại): tải về mất khoảng 40–50 phút, tải lên lại thường chậm hơn nhiều nên mất thêm 2–3 giờ — tổng khoảng 3–4 giờ, chưa kể công sắp xếp lại thủ công.<br><br>Dùng SwiftCopy.Drive: vì copy diễn ra trực tiếp giữa Google với Google (không qua đường truyền mạng của bạn), cùng khối lượng này thường chỉ mất khoảng 10–15 phút và các thư mục Drive nguồn không bị lẫn lộn.<br><br>→ Tiết kiệm gần như toàn bộ thời gian so với cách làm thủ công.<br><br>(Đây là ví dụ minh hoạ để tham khảo dựa trên cơ chế hoạt động thực tế, thời gian thật có thể thay đổi tuỳ số lượng/kích thước file.)` }
];

// Nội dung 3 trang chính sách — cập nhật trực tiếp tại đây khi có nội dung thật
const policyData = {
    terms:   { title: 'Điều khoản sử dụng',   content: 'Nội dung sẽ được cập nhật sớm.' },
    privacy: { title: 'Chính sách bảo mật',   content: 'Nội dung sẽ được cập nhật sớm.' },
    refund:  { title: 'Chính sách hoàn tiền', content: 'Nội dung sẽ được cập nhật sớm.' }
};

let selectedStars = 0;

document.getElementById('bellIcon').addEventListener('click', function(e) { e.stopPropagation(); togglePopover('bellPopover'); });
document.getElementById('helpIcon').addEventListener('click', function(e) { e.stopPropagation(); togglePopover('helpPopover'); });
document.addEventListener('click', function() {
    const b=document.getElementById('bellPopover'), h=document.getElementById('helpPopover');
    if(b) b.style.display='none'; if(h) h.style.display='none';
});

function togglePopover(id) {
    const current = document.getElementById(id);
    const secondaryId = id === 'bellPopover' ? 'helpPopover' : 'bellPopover';
    document.getElementById(secondaryId).style.display = 'none';
    current.style.display = current.style.display === 'block' ? 'none' : 'block';
}

function openZaloHelp() { document.getElementById('supportModal').classList.add('active'); }
function openLangModal() { document.getElementById('langModal').classList.add('active'); }
function triggerFaqModal() { document.getElementById('helpPopover').style.display = 'none'; openFaqModal(); }
function openEarnModal() { document.getElementById('earnModal').classList.add('active'); }

document.getElementById('reviewBtn').addEventListener('click', function() {
    selectedStars = 0; updateStarUI();
    document.getElementById('reviewTextArea').value = '';
    document.getElementById('feedbackField').classList.add('hidden');
    renderReviewsInAddModal();
    document.getElementById('addReviewModal').classList.add('active');
});
function setReviewStars(num) {
    selectedStars = num; updateStarUI();
    document.getElementById('feedbackField').classList.remove('hidden');
}
function updateStarUI() {
    const stars = document.querySelectorAll('#starRatingContainer span');
    stars.forEach((star, index) => { if(index < selectedStars) star.classList.add('selected'); else star.classList.remove('selected'); });
}
function submitReviewForm() {
    if(selectedStars === 0) { alert("Vui lòng chọn số sao."); return; }
    const commentText = document.getElementById('reviewTextArea').value.trim();
    initialReviews.unshift({ email: "khachhang.demo2026@gmail.com", stars: selectedStars, comment: commentText || "Đánh giá tốt!" });
    alert("Cảm ơn đóng góp phản hồi của bạn!");
    closeAllModals();
}

function openReviewListModal() {
    const container = document.getElementById('reviewListContent'); container.innerHTML = "";
    let html = "";
    initialReviews.forEach((item, index) => {
        let anonymized = anonymizeUserEmail(item.email);
        let starString = "★".repeat(item.stars) + "☆".repeat(5 - item.stars);
        const borderStyle = index === initialReviews.length - 1 ? '' : 'border-bottom:1px solid #f1f3f5;';
        html += `<div style="padding:10px 0;${borderStyle}" id="reviewItem-${index}"><div class="flex justify-between" style="font-weight:700;font-size:12px;margin-bottom:4px;"><span class="text-black">${anonymized}</span><span class="text-[#ffca28]">${starString}</span></div><div style="font-size:12px;color:#6c757d;line-height:1.625;">${item.comment}</div></div>`;
    });
    container.innerHTML = html;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (initialReviews.length > 6) {
                const sixthItem = container.children[5];
                const h = sixthItem.offsetTop + sixthItem.offsetHeight;
                container.style.maxHeight = h + 'px';
            } else {
                container.style.maxHeight = '';
            }
            document.getElementById('reviewListModal').classList.add('active');
        });
    });
}
function anonymizeUserEmail(email) {
    if (!email.includes("@")) return email;
    let parts = email.split("@"); let name = parts[0]; let domain = parts[1];
    if (name.length <= 4) return name.substring(0, 2) + "********@" + domain;
    return name.substring(0, 2) + "********" + name.substring(name.length - 4) + "@" + domain;
}

// Render danh sách đánh giá vào modal gộp (#addReviewModal)
function renderReviewsInAddModal() {
    const container = document.getElementById('addReviewListContent');
    let html = '';
    initialReviews.forEach((item, index) => {
        const anonymized = anonymizeUserEmail(item.email);
        const starString = '★'.repeat(item.stars) + '☆'.repeat(5 - item.stars);
        const borderStyle = index === initialReviews.length - 1 ? '' : 'border-bottom:1px solid #f1f3f5;';
        html += `<div style="padding:10px 0;${borderStyle}"><div style="display:flex;justify-content:space-between;font-weight:700;font-size:12px;margin-bottom:4px;"><span style="color:#212529">${anonymized}</span><span style="color:#ffca28">${starString}</span></div><div style="font-size:12px;color:#6c757d;line-height:1.625;">${item.comment}</div></div>`;
    });
    container.innerHTML = html;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (container.children.length > 4) {
                const fourth = container.children[3];
                container.style.maxHeight = (fourth.offsetTop + fourth.offsetHeight) + 'px';
            } else {
                container.style.maxHeight = '';
            }
        });
    });
}

// Mở modal chính sách với nội dung từ policyData
function openPolicyModal(type) {
    const p = policyData[type]; if (!p) return;
    document.getElementById('policyModalTitle').textContent = p.title;
    document.getElementById('policyModalContent').innerHTML = p.content;
    document.getElementById('policyModal').classList.add('active');
}

// Mở hub modal "Chính sách & đánh giá" từ header dropdown
function openPolicyAndReviewModal() {
    document.getElementById('helpPopover').style.display = 'none';
    document.getElementById('policyAndReviewModal').classList.add('active');
}

// Đóng hub modal rồi mở đúng modal chính sách tương ứng
function switchToPolicyModal(type) {
    closeAllModals();
    openPolicyModal(type);
}

// Đóng hub modal rồi mở modal đánh giá gộp
function switchToReviewModal() {
    closeAllModals();
    selectedStars = 0; updateStarUI();
    document.getElementById('reviewTextArea').value = '';
    document.getElementById('feedbackField').classList.add('hidden');
    renderReviewsInAddModal();
    document.getElementById('addReviewModal').classList.add('active');
}

function openFaqModal() {
    const faqContainer = document.getElementById('faqContentContainer'); faqContainer.innerHTML = "";
    let html = "";
    adminFaqData.forEach((item, index) => {
        html += `<div style="border:1px solid #e9ecef;border-radius:12px;margin-bottom:10px;overflow:hidden;" id="faqItem-${index}"><div class="hover:bg-[#fffbea] active:bg-[#fff3c4] transition-colors" style="background:#f8f9fa;padding:12px 16px;font-weight:700;font-size:13px;display:flex;justify-content:space-between;cursor:pointer;user-select:none;" onclick="toggleFaqAccordion(${index})"><span>${item.q}</span><span class="transition-transform duration-200">▼</span></div><div class="hidden" style="padding:16px;font-size:13px;color:#6c757d;line-height:1.625;background:#fff;border-top:1px solid #e9ecef;">${item.a}</div></div>`;
    });
    faqContainer.innerHTML = html;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (adminFaqData.length > 5) {
                const fifthItem = faqContainer.children[4];
                const h = fifthItem.offsetTop + fifthItem.offsetHeight;
                faqContainer.style.maxHeight = h + 'px';
            } else {
                faqContainer.style.maxHeight = '';
            }
            document.getElementById('faqModal').classList.add('active');
        });
    });
}
function toggleFaqAccordion(index) {
    const target = document.getElementById(`faqItem-${index}`);
    const content = target.querySelector('div:nth-child(2)');
    const arrow = target.querySelector('span:nth-child(2)');
    const isHidden = content.classList.contains('hidden');

    document.querySelectorAll('[id^="faqItem-"]').forEach(el => {
        el.querySelector('div:nth-child(2)').classList.add('hidden');
        el.querySelector('span:nth-child(2)').classList.remove('rotate-180');
    });

    if (isHidden) {
        content.classList.remove('hidden');
        arrow.classList.add('rotate-180');
    }
}

function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active')); }
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAllModals(); });

/* ══════════════ PREVIEW DASHBOARD — FULLSCREEN TOGGLE ══════════════
   Moves the actual #pvCard node (not a clone) into a fullscreen overlay
   so the existing animation loop keeps running untouched — same DOM
   nodes, same id references, just a different parent in the tree. */
let _pvOriginalParent = null, _pvOriginalNextSibling = null;

function openPvFullscreen() {
  const card = document.getElementById('pvCard');
  const slot = document.getElementById('pvFullscreenSlot');
  const overlay = document.getElementById('pvFullscreenOverlay');
  const blur = document.getElementById('pvBlurBadge');
  if (!card || !slot || !overlay) return;
  _pvOriginalParent = card.parentNode;
  _pvOriginalNextSibling = card.nextSibling;
  slot.appendChild(card);
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  if (blur) blur.style.display = 'none';
}

function closePvFullscreen() {
  const card = document.getElementById('pvCard');
  const overlay = document.getElementById('pvFullscreenOverlay');
  const blur = document.getElementById('pvBlurBadge');
  if (!card || !overlay || !_pvOriginalParent) return;
  _pvOriginalParent.insertBefore(card, _pvOriginalNextSibling);
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  if (blur) blur.style.display = '';
}

document.getElementById('pvCard')?.addEventListener('dblclick', openPvFullscreen);
document.getElementById('pvFullscreenOverlay')?.addEventListener('click', function(e) {
  if (e.target === e.currentTarget) closePvFullscreen();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closePvFullscreen();
});

/* ══════════════ PREVIEW DASHBOARD DEMO ANIMATION ══════════════
   Auto-looping "product demo" animation for the logged-out landing page.
   Purely cosmetic — gives visitors an instant feel for how the real
   dashboard behaves without needing to sign in or install anything. */
(function(){
  const els = {
    bar:    document.getElementById('pvProgBar'),
    pct:    document.getElementById('pvPercentText'),
    status: document.getElementById('pvStatusText'),
    ok:     document.getElementById('pvStatOk'),
    err:    document.getElementById('pvStatErr'),
    fold:   document.getElementById('pvStatFold'),
    logRunning: document.getElementById('pvLogRunning'),
    logBox: document.getElementById('pvLogBox'),
    folder1: document.getElementById('pvFolderRow1'),
    folder2: document.getElementById('pvFolderRow2'),
    btnScan: document.getElementById('pvBtnScan'),
    btnCopy: document.getElementById('pvBtnCopy')
  };
  if (!els.bar) return; // not on the landing page

  const FILES = [
    '55. Hàm thống kê - SUM.mp4',
    '56. Hàm thống kê - COUNT.mp4',
    '58. Hàm thống kê - MIN.mp4',
    '60. Hàm thống kê - RANK.mp4',
    'Bill of lading.pdf',
    'Hợp đồng thương mại.docx'
  ];
  const TARGET_PCT = 73, TARGET_OK = 70, TARGET_ERR = 139, TARGET_FOLD = 25;
  const DURATION_MS = 3600;     // time to animate 0 -> target
  const HOLD_MS = 1400;         // pause at "complete" before resetting
  const STEP_MS = 250;          // was 90ms — throttled to reduce main-thread contention while staying visually smooth

  // Skip the heavy DOM-update work entirely whenever any demo modal (review/earn/FAQ...)
  // is open, since the preview card is hidden behind the overlay anyway. This stops the
  // animation from competing with the browser's main thread for clicks/typing inside modals.
  function anyModalOpen(){ return !!document.querySelector('.modal-overlay.active'); }

  function setHighlight(el, on){
    if(!el) return;
    el.style.background = on ? '#fffbea' : '';
    el.style.borderColor = on ? '#f0d060' : '';
  }

  function lerp(t){ return t<0.5 ? 2*t*t : -1+(4-2*t)*t; } // easeInOutQuad

  let frame = 0;
  const totalFrames = Math.round(DURATION_MS / STEP_MS);

  function tick(){
    if (anyModalOpen()){ setTimeout(tick, STEP_MS); return; } // paused while a modal covers the preview

    frame++;
    const t = Math.min(1, frame / totalFrames);
    const eased = lerp(t);

    const pct = Math.round(eased * TARGET_PCT);
    els.bar.style.width = pct + '%';
    els.pct.textContent = pct + '%';
    els.ok.textContent = Math.round(eased * TARGET_OK);
    els.err.textContent = Math.round(eased * TARGET_ERR);
    els.fold.textContent = Math.round(eased * TARGET_FOLD);

    const fileIdx = Math.min(FILES.length-1, Math.floor(eased * FILES.length));
    els.status.textContent = 'Đang xử lý: ' + FILES[fileIdx];
    els.logRunning.textContent = '>> RUNNING: ' + FILES[fileIdx] + '...';

    // Highlight folder rows roughly in sync with progress
    setHighlight(els.folder1, pct > 15 && pct < 45);
    setHighlight(els.folder2, pct >= 45 && pct < 73);

    if (t < 1){
      setTimeout(tick, STEP_MS);
    } else {
      onComplete();
    }
  }

  function onComplete(){
    // Brief "done" state
    els.status.textContent = 'Hoàn thành — đã sao chép xong';
    els.btnCopy.textContent = 'Đã xong ✓';
    els.btnCopy.style.background = '#1a9950';
    setHighlight(els.folder1, false);
    setHighlight(els.folder2, false);

    setTimeout(resetAndLoop, HOLD_MS);
  }

  function resetAndLoop(){
    frame = 0;
    els.bar.style.width = '0%';
    els.pct.textContent = '0%';
    els.ok.textContent = '0';
    els.err.textContent = '0';
    els.fold.textContent = '0';
    els.status.textContent = 'Đang chuẩn bị...';
    els.logRunning.textContent = '>> Đang khởi động lại bản mô phỏng...';
    els.btnCopy.textContent = 'Dừng copy';
    els.btnCopy.style.background = '#212529';
    setTimeout(tick, 500);
  }

  // Start the loop once the page is idle
  setTimeout(tick, 600);
})();
