const API = "http://localhost:3000";
let allAssets = [];

// ─── FETCH ALL CHECKED OUT ───
async function fetchAssets() {
    try {
        //get checked out items
        const res = await fetch(`${API}/checkedout`);
        if (!res.ok) throw new Error();
        allAssets = await res.json();
        //set refresh time
        const now = new Date();
        document.getElementById("refresh-time").textContent =
            now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        filterAssets();
    } catch {
        document.getElementById("asset-list").innerHTML =
            `<div class="empty-state"><span class="big">!</span>Could not reach API</div>`;
    }
}

// ─── FILTER IN LOCAL JS ───
function filterAssets() {
    const q = document.getElementById("search").value.toLowerCase().trim(); //sanitize
    //filter based on search bar value
    const filtered = q
        ? allAssets.filter(
              (a) =>
                  (a.name || "").toLowerCase().includes(q) ||
                  (a.asset || "").toLowerCase().includes(q) ||
                  (a.location || "").toLowerCase().includes(q),
          )
        : allAssets;

    //how many items are there
    document.getElementById("count-label").innerHTML =
        `<span>${filtered.length}</span> item${filtered.length !== 1 ? "s" : ""}`;

    //pass filtered list to render it
    renderAssets(filtered);
}

function renderAssets(assets) {
    const list = document.getElementById("asset-list");
    if (!assets.length) {
        //if no items display a indicator
        list.innerHTML = `<div class="empty-state"><span class="big">⊘</span>${
            document.getElementById("search").value
                ? "No matching assets"
                : "All assets returned"
        }</div>`;
        return;
    }

    //for all filtered assets create a card
    list.innerHTML = assets
        .map(
            (a, i) => `
    <div class="asset-card" style="animation-delay:${i * 30}ms" id="card-${a.id}">
      <button class="btn-return" onclick="handleReturn('${a.id}', this)">
        RETURN
      </button>
      <div class="card-body">
              <span class="card-asset">${escHtml(a.name)}</span>
              <span class="card-user">${escHtml(a.asset)}</span>
              <span class="card-location">${escHtml(a.location)}</span>
              <span class="card-time">CHECKED OUT ${formatDate(a.checkout)}</span>
            </div>
      <span class="card-id-pill">${a.id.slice(0, 8)}</span>
    </div>
  `,
        )
        .join("");
}

// ─── CHECKOUT ───
async function handleCheckout(e) {
    e.preventDefault();
    //get checkout values
    const user = document.getElementById("f-user").value.trim();
    const asset = document.getElementById("f-asset").value.trim();
    const location = document.getElementById("f-location").value.trim();
    const btn = document.getElementById("submit-btn");

    //make disabled while processing
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
        //post request to node to add item to daily table
        const res = await fetch(
            `${API}/checkout/${encodeURIComponent(user)}/${encodeURIComponent(asset)}/${encodeURIComponent(location)}`,
            { method: "POST" },
        );
        const msg = await res.text();
        if (!res.ok) throw new Error(msg);
        //send toast
        showToast(msg, "success");
        //clear the form
        document.getElementById("checkout-form").reset();
        //refetch assets after insert
        await fetchAssets();
    } catch (err) {
        //show toast
        showToast(err.message || "Checkout failed", "error");
    } finally {
        //reenable
        btn.disabled = false;
        btn.textContent = "Check Out";
    }
}

// ─── RETURN ───
async function handleReturn(id, btn) {
    const original = btn.textContent;
    btn.disabled = true; //disable button which process
    btn.innerHTML = '<span class="spinner"></span>'; //default for loading

    try {
        //send update request to node
        const res = await fetch(`${API}/checkin/${id}`, { method: "POST" });
        const msg = await res.text();
        if (!res.ok) throw new Error(msg);
        //send toast
        showToast(msg, "success");

        // optimistic remove - show on page before confirmed db insert
        const card = document.getElementById(`card-${id}`);
        if (card) {
            card.style.transition = "opacity 0.2s, transform 0.2s";
            card.style.opacity = "0";
            card.style.transform = "translateX(10px)";
            setTimeout(() => {
                allAssets = allAssets.filter((a) => a.id !== id);
                filterAssets();
            }, 200);
        }
    } catch (err) {
        //send toast
        showToast(err.message || "Return failed", "error");
        btn.disabled = false; //reenable
        btn.textContent = original; //show text instead of spinner
    }
}

// ─── HELPERS ───
function showToast(msg, type) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = `show ${type}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
        t.className = "";
    }, 3200);
}

//formate the date string from db
function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso)
        .toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
        .toUpperCase();
}

function escHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ─── INIT ───
fetchAssets();
setInterval(fetchAssets, 30000);
