'use strict';
var player_data = JSON.parse(document.getElementById('player_data').textContent);
var video_data = JSON.parse(document.getElementById('video_data').textContent);

// ------------------ Invidious custom quality selector ------------------
const ITAG_MAP = {
  '17': { height: 144, label: '144p' },
  '18': { height: 360, label: '360p' },
  '22': { height: 720, label: '720p' }
};

const AUDIO_ITAG_MAP = {
  '139': { bitrate: 48, codec: 'm4a', label: 'm4a48k' },
  '140': { bitrate: 128, codec: 'm4a', label: 'm4a128k' },
  '141': { bitrate: 256, codec: 'm4a', label: 'm4a256k' },
  '249': { bitrate: 50, codec: 'opus', label: 'opus50k' },
  '250': { bitrate: 70, codec: 'opus', label: 'opus70k' },
  '251': { bitrate: 160, codec: 'opus', label: 'opus160k' }
};

class QualityMenuItem extends videojs.getComponent('MenuItem') {
  handleClick(event) {
    super.handleClick(event);

    if (this.options_.handler) {
      this.options_.handler.call(this, event);
    }
    const menu = this.parentComponent_;
    if (menu && menu.menuButton_) {
      menu.menuButton_.unpressButton();
    }
  }
}

class QualityMultiSelector extends videojs.getComponent('MenuButton') {
  constructor(player, options = {}) {
    super(player, options);

    this.controlText('Quality');
    this.addClass('vjs-quality-multi-selector');
    const iconSpan = this.el().querySelector('.vjs-icon-placeholder');
    if (iconSpan) {
      iconSpan.classList.add('vjs-icon-cog');
    }
    this._onDocumentTouchEnd = (event) => {
      if (!this.buttonPressed_) return;
      const target = event.target;
      if (
        target &&
        !this.el().contains(target) &&
        !this.menu.el().contains(target)
      ) {
        this.unpressButton();
      }
    };
    document.addEventListener('touchend', this._onDocumentTouchEnd);
    this.on('dispose', () => {
      document.removeEventListener('touchend', this._onDocumentTouchEnd);
    });

    Object.assign(this, {
      _mode: 'dash',
      _dashLevels: [],
      _mp4Sources: [],
      _selectedIndex: -1,
      _autoSelected: true,
      _suppressEventsUntilLoaded: false
    });

    player._qualityMultiSelector = this;
    this._updateModeAndData();
    this._setupListeners();
    this._rebuildMenu();
  }

  _setupListeners() {
    const player = this.player();
    const update = () => {
      if (this._suppressEventsUntilLoaded) return;
      this._updateModeAndData();
      this._rebuildMenu();
    };

    if (player.qualityLevels) {
      const qLevels = player.qualityLevels();
      qLevels.on('addqualitylevel', update);
      qLevels.on('removequalitylevel', update);
    }

    player.on('sourceset', update);
    player.on('loadedmetadata', update);
  }

  _updateModeAndData() {
    const player = this.player();
    const qLevels = player.qualityLevels ? player.qualityLevels() : null;

    if (qLevels && qLevels.length > 0) {
      this._mode = 'dash';
      this._mp4Sources = [];
      this._dashLevels = Array.prototype.map.call(qLevels, (level, originalIndex) => ({ level, originalIndex }))
        .sort((a, b) =>
          (this._getHeight(b.level) - this._getHeight(a.level)) ||
          (this._getFrameRate(b.level) - this._getFrameRate(a.level)) ||
          (this._getBitrate(b.level) - this._getBitrate(a.level))
        );
      this._selectedIndex = -1;
    } else {
      this._dashLevels = [];
      const sources = player.currentSources ? player.currentSources() : [];
      const allAudio = sources.length > 0 && sources.every(source => this._isAudioSource(source));
      this._mode = allAudio ? 'audio' : 'mp4';

      this._mp4Sources = sources
        .slice()
        .sort((a, b) => {
          if (this._mode === 'audio') {
            return this._getAudioBitrate(b) - this._getAudioBitrate(a);
          }
          return this._heightFromSource(b) - this._heightFromSource(a);
        });

      this._selectedIndex = -1;
      this._autoSelected = true;

      const currentSrc = player.currentSrc();
      if (currentSrc) {
        const normalizedCurrent = this._normalizeSrc(currentSrc);
        const index = this._mp4Sources.findIndex(
          source => this._normalizeSrc(source.src) === normalizedCurrent
        );
        if (index !== -1) {
          this._selectedIndex = index;
          this._autoSelected = false;
        }
      }
    }
  }

  _normalizeSrc(src) {
    if (!src) return '';
    try {
      return new URL(src, document.baseURI).href;
    } catch (e) {
      return src;
    }
  }

  _isAudioSource(source) {
    if (!source) return false;

    const src = source.src || '';
    const itag = (src.match(/itag=(\d+)/i) || [])[1];

    if (itag && AUDIO_ITAG_MAP[itag]) return true;

    return (source.type || '').toLowerCase().startsWith('audio/');
  }

  _getAudioBitrate(source) {
    const src = source.src || '';
    const itag = (src.match(/itag=(\d+)/i) || [])[1];

    if (itag && AUDIO_ITAG_MAP[itag]) return AUDIO_ITAG_MAP[itag].bitrate;

    return source.bitrate || 0;
  }

  _rebuildMenu() {
    if (!this.menu) return;

    while (this.menu.children_.length) {
      this.menu.removeChild(this.menu.children_[0]);
    }

    this.createItems().forEach(item => this.menu.addChild(item));
  }

  _updateSelectedMenuItem(selectedIndex) {
    if (!this.menu) return;
    const items = this.menu.children_;

    for (let i = 0; i < items.length; i++) {
      if (i === selectedIndex) {
        items[i].addClass('vjs-selected');
      } else {
        items[i].removeClass('vjs-selected');
      }
    }
  }

  createItems() {
    if (!this._dashLevels) this._dashLevels = [];
    if (!this._mp4Sources) this._mp4Sources = [];
    if (this._mode === undefined) this._mode = 'dash';
    if (this._autoSelected === undefined) this._autoSelected = true;
    if (this._selectedIndex === undefined) this._selectedIndex = -1;

    const items = [];

    const addItem = (label, className, handler, selected) => {
      const item = new QualityMenuItem(this.player(), { label, handler });
      if (className) item.addClass(className);
      if (selected) item.addClass('vjs-selected');
      items.push(item);
    };

    if (this._mode === 'dash') {
      addItem('Auto', 'vjs-quality-menu-item-auto', () => this.selectAuto(), this._autoSelected);

      for (const { level, originalIndex } of this._dashLevels) {
        addItem(
          this.labelForDashLevel(level),
          'vjs-quality-menu-item',
          () => this.selectDashQuality(originalIndex),
          !this._autoSelected && this._selectedIndex === originalIndex
        );
      }
    } else if (this._mode === 'audio') {
      this._mp4Sources.forEach((source, index) => {
        addItem(
          this.labelForAudioSource(source),
          'vjs-quality-menu-item',
          () => this.selectMp4Quality(index),
          this._selectedIndex === index
        );
      });
    } else {
      this._mp4Sources.forEach((source, index) => {
        addItem(
          this.labelForMp4Source(source),
          'vjs-quality-menu-item',
          () => this.selectMp4Quality(index),
          this._selectedIndex === index
        );
      });
    }

    return items;
  }

  labelForDashLevel(level) {
    const height = this._getHeight(level);
    if (height > 0) {
      const fps = this._getFrameRate(level);
      return fps > 0 ? `${height}p@${fps}` : `${height}p`;
    }
    if (level.width) return `${level.width}p`;
    if (level.bitrate) return this._formatBitrate(level.bitrate);
    return `Quality ${level.id}`;
  }

  labelForMp4Source(source) {
    const src = source.src || '';
    const itag = (src.match(/itag=(\d+)/i) || [])[1];
    const info = ITAG_MAP[itag];
    const label = info ? info.label : (source.label || 'Source');
    return `${label}-${src.toLowerCase().includes('local=true') ? 'local' : 'google'}`;
  }

  labelForAudioSource(source) {
    const src = source.src || '';
    const itag = (src.match(/itag=(\d+)/i) || [])[1];
    const info = AUDIO_ITAG_MAP[itag];
    const label = info ? info.label : (source.label || 'Audio');
    return `${label}-${src.toLowerCase().includes('local=true') ? 'local' : 'google'}`;
  }

  _heightFromSource(source) {
    const src = source.src || '';
    const itag = (src.match(/itag=(\d+)/i) || [])[1];
    if (itag) return ITAG_MAP[itag] ? ITAG_MAP[itag].height : 0;
    return source.height || 0;
  }

  _getHeight(level) { return level.height || 0; }

  _getFrameRate(level) {
    let fps = level.frameRate;
    if (fps === undefined || fps === null) return 0;

    if (typeof fps === 'string') {
      const match = fps.match(/(\d+(?:\.\d+)?)/);
      if (!match) return 0;
      fps = parseFloat(match[1]);
    }

    const num = Math.round(Number(fps));
    return isNaN(num) ? 0 : num;
  }

  _getBitrate(level) { return level.bitrate || 0; }

  _formatBitrate(bits) {
    return bits >= 1000000
      ? `${(bits / 1000000).toFixed(1)} Mbps`
      : `${Math.round(bits / 1000)} kbps`;
  }

  selectAuto() {
    const levels = this.player().qualityLevels();
    for (let i = 0; i < levels.length; i++) {
      levels[i].enabled = true;
    }

    this._autoSelected = true;
    this._selectedIndex = -1;
    this._updateSelectedMenuItem(0);
  }

  selectDashQuality(originalIndex) {
    const levels = this.player().qualityLevels();
    for (let i = 0; i < levels.length; i++) {
      levels[i].enabled = (i === originalIndex);
    }

    this._autoSelected = false;
    this._selectedIndex = originalIndex;

    const itemIndex = this._dashLevels.findIndex(
      ({ originalIndex: idx }) => idx === originalIndex
    );
    if (itemIndex !== -1) {
      this._updateSelectedMenuItem(itemIndex + 1);
    }
  }

  selectMp4Quality(index) {
    const source = this._mp4Sources[index];
    if (!source) return;

    const player = this.player();
    const currentTime = player.currentTime();
    const wasPaused = player.paused();

    this._suppressEventsUntilLoaded = true;
    player.src(source);

    player.one('loadedmetadata', () => {
      player.currentTime(currentTime);
      if (!wasPaused) player.play();
      this._suppressEventsUntilLoaded = false;
    });

    this._autoSelected = false;
    this._selectedIndex = index;
    this._updateSelectedMenuItem(index);
  }

  setAuto() {
    if (this._mode === 'dash') this.selectAuto();
  }

  setQualityIndex(index) {
    if (this._mode === 'dash') this.selectDashQuality(index);
    else this.selectMp4Quality(index);
  }

  buildCSSClass() {
    return `vjs-quality-multi-selector ${super.buildCSSClass()}`;
  }
}

videojs.registerComponent('QualityMultiSelector', QualityMultiSelector);

// ------------------ SHARE BUTTON COMPONENT ------------------
class ShareButton extends videojs.getComponent('Button') {
  constructor(player, options) {
    super(player, options);
    this.controlText('Share');
    this.addClass('vjs-share-control');

    const iconSpan = this.el().querySelector('.vjs-icon-placeholder');
    if (iconSpan) {
      iconSpan.classList.add('vjs-icon-share');
    }
  }

  handleClick() {
    this.openShareDialog();
  }

  openShareDialog() {
    if (!this.player_.shareDialog || this.player_.shareDialog.isDisposed()) {
      this.player_.shareDialog = new ShareDialog(this.player_, {});
      this.player_.addChild(this.player_.shareDialog);
    }
    this.player_.shareDialog.open();
  }
}
videojs.registerComponent('ShareButton', ShareButton);

// ------------------ SHARE DIALOG COMPONENT ------------------
class ShareDialog extends videojs.getComponent('ModalDialog') {
  constructor(player, options) {
    super(player, Object.assign({
      temporary: false,      // keep dialog in DOM for reopening
      closeable: true,
      label: 'Share Menu',
      content: () => this.buildContent()
    }, options));

    this.addClass('vjs-share-dialog');
  }

  buildContent() {
    const container = document.createElement('div');
    container.className = 'share-dialog-content';

    const header = document.createElement('div');
    header.className = 'share-dialog-header';
    header.textContent = 'Share';
    container.appendChild(header);

    const urlGroup = this.createInputGroup('Direct Link:', 'share-url-input');
    const embedGroup = this.createInputGroup('Embed Code:', 'share-embed-input');
    container.appendChild(urlGroup);
    container.appendChild(embedGroup);

    const socialsDiv = document.createElement('div');
    socialsDiv.className = 'share-dialog-socials';
    const socialItems = [
      { id: 'fbFeed', css: 'social-fb', label: 'f' },
      { id: 'tw', css: 'social-tw', label: '𝕏' },
      { id: 'reddit', css: 'social-reddit', label: 'R' },
      { id: 'email', css: 'social-email', label: '✉' }
    ];
    socialItems.forEach(item => {
      const link = document.createElement('a');
      link.className = `social-btn ${item.css}`;
      link.textContent = item.label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.socialId = item.id;
      socialsDiv.appendChild(link);
    });
    container.appendChild(socialsDiv);

    return container;
  }

  createInputGroup(labelText, inputId) {
    const group = document.createElement('div');
    group.className = 'share-input-group';
    const label = document.createElement('label');
    label.textContent = labelText;
    const wrapper = document.createElement('div');
    wrapper.className = 'share-input-wrapper';
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.id = inputId;
    input.style.color = '#fff';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'share-copy-btn';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
    `;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(input.value).then(() => {
        copyBtn.style.color = '#4caf50';
        setTimeout(() => copyBtn.style.color = '', 2000);
      });
    });
    wrapper.appendChild(input);
    wrapper.appendChild(copyBtn);
    group.appendChild(label);
    group.appendChild(wrapper);
    return group;
  }

  updateValues() {
    const url = shareOptions.url;
    const embed = shareOptions.embedCode;

    const urlInput = this.el().querySelector('#share-url-input');
    const embedInput = this.el().querySelector('#share-embed-input');
    if (urlInput) urlInput.value = url;
    if (embedInput) embedInput.value = embed;

    const socials = this.el().querySelectorAll('.social-btn');
    socials.forEach(btn => {
      const id = btn.dataset.socialId;
      let href = '#';
      if (id === 'fbFeed') href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
      else if (id === 'tw') href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareOptions.title)}`;
      else if (id === 'reddit') href = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareOptions.title)}`;
      else if (id === 'email') href = `mailto:?subject=${encodeURIComponent(shareOptions.title)}&body=${encodeURIComponent(url)}`;
      btn.href = href;
    });
  }

  open() {
    // Ensure values are updated after the modal is fully opened and content is in DOM
    this.one('modalopen', () => this.updateValues());
    super.open();
  }
}
videojs.registerComponent('ShareDialog', ShareDialog);

var options = {
    liveui: true,
    playbackRates: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
    fontPercent: [0.5, 0.75, 1.25, 1.5, 1.75, 2, 3, 4],
    windowOpacity: ['0', '0.5', '1'],
    textOpacity: ['0.5', '1'],
    persistTextTrackSettings: true,
    enableSourceset: false,
    controlBar: {
        children: [
            'playToggle',
            'volumePanel',
            'currentTimeDisplay',
            'timeDivider',
            'durationDisplay',
            'progressControl',
            'remainingTimeDisplay',
            'Spacer',
            'captionsButton',
            'audioTrackButton',
            'QualityMultiSelector',
            'playbackRateMenuButton',
            'ShareButton',
            'fullscreenToggle'
        ]
    },
    html5: {
        preloadTextTracks: false,
        vhs: {
            overrideNative: true,
            experimentalUseMMS: true
        }
    }
};

if (player_data.aspect_ratio) {
    options.aspectRatio = player_data.aspect_ratio;
}

var embed_url = new URL(location);
embed_url.searchParams.delete('v');
var short_url = location.origin + '/' + video_data.id + embed_url.search;
embed_url = location.origin + '/embed/' + video_data.id + embed_url.search;

var save_player_pos_key = 'save_player_pos';

videojs.Vhs.xhr.onRequest = function(options) {
    // set local if requested not videoplayback
    if (!options.uri.includes('videoplayback')) {
        if (!options.uri.includes('local=true'))
            options.uri += '?local=true';
    }
    return options;
};

var player = videojs('player', options);

player.on('error', function () {
    if (video_data.params.quality === 'dash') return;

    var localNotDisabled = (
        !player.currentSrc().includes('local=true') && !video_data.local_disabled
    );
    var reloadMakesSense = (
        player.error().code === MediaError.MEDIA_ERR_NETWORK ||
        player.error().code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
    );

    if (localNotDisabled) {
        // add local=true to all current sources
        player.src(player.currentSources().map(function (source) {
            source.src += '&local=true';
            return source;
        }));
    } else if (reloadMakesSense) {
        setTimeout(function () {
            console.warn('An error occurred in the player, reloading...');

            // After load() all parameters are reset. Save them
            var currentTime = player.currentTime();
            var playbackRate = player.playbackRate();
            var paused = player.paused();

            player.load();

            if (currentTime > 0.5) currentTime -= 0.5;

            player.currentTime(currentTime);
            player.playbackRate(playbackRate);
            if (!paused) player.play();
        }, 5000);
    }
});

if (video_data.params.quality === 'dash') {
    player.reloadSourceOnError({
        errorInterval: 10
    });
}

/**
 * Function for add time argument to url
 *
 * @param {String} url
 * @param {String} [base]
 * @param {'t' | 'start'} param
 * @returns {URL} urlWithTimeArg
 */
function addCurrentTimeToURL(url, base, param = 't') {
    var urlUsed = new URL(url, base);
    urlUsed.searchParams.delete('start');
    var currentTime = Math.ceil(player.currentTime());
    if (currentTime > 0)
        urlUsed.searchParams.set(param, currentTime);
    else if (urlUsed.searchParams.has('t'))
        urlUsed.searchParams.delete('t');
    return urlUsed;
}

/**
 * Global variable to save the last timestamp (in full seconds) at which the external
 * links were updated by the 'timeupdate' callback below.
 *
 * It is initialized to 5s so that the video will always restart from the beginning
 * if the user hasn't really started watching before switching to the other website.
 */
var timeupdate_last_ts = 5;

/**
 * Callback that updates the timestamp on all external links
 */
player.on('timeupdate', function () {
    // Only update once every second
    let current_ts = Math.floor(player.currentTime());
    if (current_ts != timeupdate_last_ts) timeupdate_last_ts = current_ts;
    else return;

    // YouTube links

    if (!video_data.live_now) {
        let elem_yt_watch = document.getElementById('link-yt-watch');
        if (elem_yt_watch) {
            let base_url_yt_watch = elem_yt_watch.getAttribute('data-base-url');
            elem_yt_watch.href = addCurrentTimeToURL(base_url_yt_watch);
        }

        let elem_yt_embed = document.getElementById('link-yt-embed');
        if (elem_yt_embed) {
            let base_url_yt_embed = elem_yt_embed.getAttribute('data-base-url');
            elem_yt_embed.href = addCurrentTimeToURL(base_url_yt_embed, undefined, 'start');
        }
    }

    // Invidious links

    let domain = window.location.origin;

    let elem_iv_embed = document.getElementById('link-iv-embed');
    if (elem_iv_embed) {
        let base_url_iv_embed = elem_iv_embed.getAttribute('data-base-url');
        elem_iv_embed.href = addCurrentTimeToURL(base_url_iv_embed, domain);
    }

    let elem_iv_other = document.getElementById('link-iv-other');
    if (elem_iv_other) {
        let base_url_iv_other = elem_iv_other.getAttribute('data-base-url');
        elem_iv_other.href = addCurrentTimeToURL(base_url_iv_other, domain);
    }

    let elem_iv_listen = document.getElementById('link-iv-listen');
    if (elem_iv_listen) {
        let base_url_iv_listen = elem_iv_listen.getAttribute('data-base-url');
        elem_iv_listen.href = addCurrentTimeToURL(base_url_iv_listen, domain);
    }
});


var shareOptions = {
    socials: ['fbFeed', 'tw', 'reddit', 'email'],

    get url() {
        return addCurrentTimeToURL(short_url);
    },
    title: player_data.title,
    description: player_data.description,
    image: player_data.thumbnail,
    get embedCode() {
        // Single quotes inside here required. HTML inserted as is into value attribute of input
        return "<iframe id='ivplayer' width='640' height='360' src='" +
            addCurrentTimeToURL(embed_url) + "' style='border:none;'></iframe>";
    }
};

if (location.pathname.startsWith('/embed/')) {
    var overlay_content = '<h1><a rel="noopener noreferrer" target="_blank" href="' + location.origin + '/watch?v=' + video_data.id + '">' + player_data.title + '</a></h1>';
    player.overlay({
        overlays: [
            { start: 'loadstart', content: overlay_content, end: 'playing', align: 'top'},
            { start: 'pause',     content: overlay_content, end: 'playing', align: 'top'}
        ]
    });
}

// Detect mobile users and initialize mobileUi for better UX
// Detection code taken from https://stackoverflow.com/a/20293441

function isMobile() {
  try{ document.createEvent('TouchEvent'); return true; }
  catch(e){ return false; }
}

if (isMobile()) {
    player.mobileUi({ touchControls: { seekSeconds: 5 * player.playbackRate() } });

    var buttons = ['playToggle', 'volumePanel', 'captionsButton', 'ShareButton'];

    if (!video_data.params.listen && video_data.params.quality === 'dash') {
        buttons.push('audioTrackButton');
        buttons.push('QualityMultiSelector');
    } else if (video_data.params.listen || video_data.params.quality !== 'dash') {
        buttons.push('QualityMultiSelector');
    }

    // Create new control bar object for operation buttons
    const ControlBar = videojs.getComponent('controlBar');
    let operations_bar = new ControlBar(player, {
      children: [],
      playbackRates: [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]
    });
    buttons.slice(1).forEach(function (child) {operations_bar.addChild(child);});

    // Remove operation buttons from primary control bar
    var primary_control_bar = player.getChild('controlBar');
    buttons.forEach(function (child) {primary_control_bar.removeChild(child);});

    var operations_bar_element = operations_bar.el();
    operations_bar_element.classList.add('mobile-operations-bar');
    player.addChild(operations_bar);

    // Playback menu doesn't work when it's initialized outside of the primary control bar
    var playback_element = document.getElementsByClassName('vjs-playback-rate')[0];
    operations_bar_element.append(playback_element);
}

// Enable VR video support
if (!video_data.params.listen && video_data.vr && video_data.params.vr_mode) {
    player.crossOrigin('anonymous');
    switch (video_data.projection_type) {
        case 'EQUIRECTANGULAR':
            player.vr({projection: 'equirectangular'});
        default: // Should only be 'MESH' but we'll use this as a fallback.
            player.vr({projection: 'EAC'});
    }
}

// Add markers
if (video_data.params.video_start > 0 || video_data.params.video_end > 0) {
    var markers = [{ time: video_data.params.video_start, text: 'Start' }];

    if (video_data.params.video_end < 0) {
        markers.push({ time: video_data.length_seconds - 0.5, text: 'End' });
    } else {
        markers.push({ time: video_data.params.video_end, text: 'End' });
    }

    player.markers({
        onMarkerReached: function (marker) {
            if (marker.text === 'End')
                player.loop() ? player.markers.prev('Start') : player.pause();
        },
        markers: markers
    });

    player.currentTime(video_data.params.video_start);
}

player.volume(video_data.params.volume / 100);
player.playbackRate(video_data.params.speed);

/**
 * Method for getting the contents of a cookie
 *
 * @param {String} name Name of cookie
 * @returns {String|null} cookieValue
 */
function getCookieValue(name) {
    var cookiePrefix = name + '=';
    var matchedCookie = document.cookie.split(';').find(function (item) {return item.includes(cookiePrefix);});
    if (matchedCookie)
        return matchedCookie.replace(cookiePrefix, '');
    return null;
}

/**
 * Method for updating the 'PREFS' cookie (or creating it if missing)
 *
 * @param {number} newVolume New volume defined (null if unchanged)
 * @param {number} newSpeed New speed defined (null if unchanged)
 */
function updateCookie(newVolume, newSpeed) {
    var volumeValue = newVolume !== null ? newVolume : video_data.params.volume;
    var speedValue = newSpeed !== null ? newSpeed : video_data.params.speed;

    var cookieValue = getCookieValue('PREFS');
    var cookieData;

    if (cookieValue !== null) {
        var cookieJson = JSON.parse(decodeURIComponent(cookieValue));
        cookieJson.volume = volumeValue;
        cookieJson.speed = speedValue;
        cookieData = encodeURIComponent(JSON.stringify(cookieJson));
    } else {
        cookieData = encodeURIComponent(JSON.stringify({ 'volume': volumeValue, 'speed': speedValue }));
    }

    // Set expiration in 2 year
    var date = new Date();
    date.setFullYear(date.getFullYear() + 2);

    var ipRegex = /^((\d+\.){3}\d+|[\dA-Fa-f]*:[\d:A-Fa-f]*:[\d:A-Fa-f]+)$/;
    var domainUsed = location.hostname;

    // Fix for a bug in FF where the leading dot in the FQDN is not ignored
    if (domainUsed.charAt(0) !== '.' && !ipRegex.test(domainUsed) && domainUsed !== 'localhost')
        domainUsed = '.' + location.hostname;

    var secure = location.protocol.startsWith("https") ? " Secure;" : "";

    document.cookie = 'PREFS=' + cookieData + '; SameSite=Lax; path=/; domain=' +
        domainUsed + '; expires=' + date.toGMTString() + ';' + secure;

    video_data.params.volume = volumeValue;
    video_data.params.speed = speedValue;
}

player.on('ratechange', function () {
    updateCookie(null, player.playbackRate());
    if (isMobile()) {
        player.mobileUi({ touchControls: { seekSeconds: 5 * player.playbackRate() } });
    }
});

player.on('volumechange', function () {
    updateCookie(Math.ceil(player.volume() * 100), null);
});

player.on('waiting', function () {
    if (player.playbackRate() > 1 && player.liveTracker.isLive() && player.liveTracker.atLiveEdge()) {
        console.info('Player has caught up to source, resetting playbackRate');
        player.playbackRate(1);
    }
});

if (video_data.premiere_timestamp && Math.round(new Date() / 1000) < video_data.premiere_timestamp) {
    player.getChild('bigPlayButton').hide();
}

if (video_data.params.save_player_pos) {
    const url = new URL(location);
    const hasTimeParam = url.searchParams.has('t');
    const rememberedTime = get_video_time();
    let lastUpdated = 0;

    if(!hasTimeParam) {
      if (rememberedTime >= video_data.length_seconds - 20)
        set_seconds_after_start(0);
      else
        set_seconds_after_start(rememberedTime);
    }

    player.on('timeupdate', function () {
        const raw = player.currentTime();
        const time = Math.floor(raw);

        if(lastUpdated !== time && raw <= video_data.length_seconds - 15) {
            save_video_time(time);
            lastUpdated = time;
        }
    });
}
else remove_all_video_times();

if (video_data.params.autoplay) {
    var bpb = player.getChild('bigPlayButton');
    bpb.hide();

    player.ready(function () {
        new Promise(function (resolve, reject) {
            setTimeout(function () {resolve(1);}, 1);
        }).then(function (result) {
            var promise = player.play();

            if (promise !== undefined) {
                promise.then(function () {
                }).catch(function (error) {
                    bpb.show();
                });
            }
        });
    });
}

if (!video_data.params.listen && video_data.params.quality === 'dash') {
    player.ready(function () {
        player.on('loadedmetadata', function () {
            const levels = Array.from(player.qualityLevels());
            if (!levels.length) return;

            let targetLevel = null;

            switch (video_data.params.quality_dash) {
                case 'auto':
                    break;
                case 'best':
                    targetLevel = levels.reduce((a, b) => (a.height > b.height ? a : b), levels[0]);
                    break;
                case 'worst':
                    targetLevel = levels.reduce((a, b) => (a.height < b.height ? a : b), levels[0]);
                    break;
                default: {
                    const targetHeight = parseInt(video_data.params.quality_dash);
                    targetLevel = levels
                        .filter(level => level.height <= targetHeight)
                        .sort((a, b) => b.height - a.height)[0];
                    if (!targetLevel) {
                        targetLevel = levels.sort((a, b) => b.height - a.height)[0];
                    }
                }
            }

            const selector = player._qualityMultiSelector;
            if (selector) {
                if (targetLevel) {
                    const qualityLevels = player.qualityLevels();
                    const targetIndex = levels.indexOf(targetLevel);
                    selector.setQualityIndex(targetIndex);
                } else {
                    selector.setAuto();
                }
            }
        });
    });
}

player.vttThumbnails({
    src: '/api/v1/storyboards/' + video_data.id + '?height=90',
    showTimestamp: true
});

// Enable annotations
if (!video_data.params.listen && video_data.params.annotations) {
    addEventListener('load', function (e) {
        addEventListener('__ar_annotation_click', function (e) {
            const url = e.detail.url,
                  target = e.detail.target,
                  seconds = e.detail.seconds;
            var path = new URL(url);

            if (path.href.startsWith('https://www.youtube.com/watch?') && seconds) {
                path.search += '&t=' + seconds;
            }

            path = path.pathname + path.search;

            if (target === 'current') {
                location.href = path;
            } else if (target === 'new') {
                open(path, '_blank', 'noopener,noreferrer');
            }
        });

        helpers.xhr('GET', '/api/v1/annotations/' + video_data.id, {
            responseType: 'text',
            timeout: 60000
        }, {
            on200: function (response) {
                var video_container = document.getElementById('player');
                videojs.registerPlugin('youtubeAnnotationsPlugin', youtubeAnnotationsPlugin);
                if (player.paused()) {
                    player.one('play', function (event) {
                        player.youtubeAnnotationsPlugin({ annotationXml: response, videoContainer: video_container });
                    });
                } else {
                    player.youtubeAnnotationsPlugin({ annotationXml: response, videoContainer: video_container });
                }
            }
        });

    });
}

function change_volume(delta) {
    const curVolume = player.volume();
    let newVolume = curVolume + delta;
    newVolume = helpers.clamp(newVolume, 0, 1);
    player.volume(newVolume);
}

function toggle_muted() {
    player.muted(!player.muted());
}

function skip_seconds(delta) {
    const duration = player.duration();
    const curTime = player.currentTime();
    let newTime = curTime + delta;
    newTime = helpers.clamp(newTime, 0, duration);
    player.currentTime(newTime);
}

function set_seconds_after_start(delta) {
    const start = video_data.params.video_start;
    player.currentTime(start + delta);
}

function save_video_time(seconds) {
    const all_video_times = get_all_video_times();
    all_video_times[video_data.id] = seconds;
    helpers.storage.set(save_player_pos_key, all_video_times);
}

function get_video_time() {
    return get_all_video_times()[video_data.id] || 0;
}

function get_all_video_times() {
    return helpers.storage.get(save_player_pos_key) || {};
}

function remove_all_video_times() {
    helpers.storage.remove(save_player_pos_key);
}

function set_time_percent(percent) {
    const duration = player.duration();
    const newTime = duration * (percent / 100);
    player.currentTime(newTime);
}

function play()  { player.play(); }
function pause() { player.pause(); }
function stop()  { player.pause(); player.currentTime(0); }
function toggle_play() { player.paused() ? play() : pause(); }

const toggle_captions = (function () {
    let toggledTrack = null;

    function bindChange(onOrOff) {
        player.textTracks()[onOrOff]('change', function (e) {
            toggledTrack = null;
        });
    }

    // Wrapper function to ignore our own emitted events and only listen
    // to events emitted by Video.js on click on the captions menu items.
    function setMode(track, mode) {
        bindChange('off');
        track.mode = mode;
        setTimeout(function () {
            bindChange('on');
        }, 0);
    }

    bindChange('on');
    return function () {
        if (toggledTrack !== null) {
            if (toggledTrack.mode !== 'showing') {
                setMode(toggledTrack, 'showing');
            } else {
                setMode(toggledTrack, 'disabled');
            }
            toggledTrack = null;
            return;
        }

        // Used as a fallback if no captions are currently active.
        // TODO: Make this more intelligent by e.g. relying on browser language.
        let fallbackCaptionsTrack = null;

        const tracks = player.textTracks();
        for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            if (track.kind !== 'captions') continue;

            if (fallbackCaptionsTrack === null) {
                fallbackCaptionsTrack = track;
            }
            if (track.mode === 'showing') {
                setMode(track, 'disabled');
                toggledTrack = track;
                return;
            }
        }

        // Fallback if no captions are currently active.
        if (fallbackCaptionsTrack !== null) {
            setMode(fallbackCaptionsTrack, 'showing');
            toggledTrack = fallbackCaptionsTrack;
        }
    };
})();

// For real-time updates to captions (if currently showing)
function update_captions() {
    if (document.body.querySelector('.vjs-text-track-cue')) {
        toggle_captions(); toggle_captions();
    }
}

function toggle_fullscreen() {
    player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen();
}

function increase_playback_rate(steps) {
    const maxIndex = options.playbackRates.length - 1;
    const curIndex = options.playbackRates.indexOf(player.playbackRate());
    let newIndex = curIndex + steps;
    newIndex = helpers.clamp(newIndex, 0, maxIndex);
    player.playbackRate(options.playbackRates[newIndex]);
}

function increase_caption_size(steps) {
    const maxIndex = options.fontPercent.length - 1;
    const fontPercent = player.textTrackSettings.getValues().fontPercent || 1.25;
    const curIndex = options.fontPercent.indexOf(fontPercent);
    let newIndex = curIndex + steps;
    newIndex = helpers.clamp(newIndex, 0, maxIndex);
    player.textTrackSettings.setValues({ fontPercent: options.fontPercent[newIndex] });
    update_captions();
}

function toggle_caption_window() {
    const numOptions = options.windowOpacity.length;
    const windowOpacity = player.textTrackSettings.getValues().windowOpacity || '0';
    const curIndex = options.windowOpacity.indexOf(windowOpacity);
    const newIndex = (curIndex + 1) % numOptions;
    player.textTrackSettings.setValues({ windowOpacity: options.windowOpacity[newIndex] });
    update_captions();
}

function toggle_caption_opacity() {
    const numOptions = options.textOpacity.length;
    const textOpacity = player.textTrackSettings.getValues().textOpacity || '1';
    const curIndex = options.textOpacity.indexOf(textOpacity);
    const newIndex = (curIndex + 1) % numOptions;
    player.textTrackSettings.setValues({ textOpacity: options.textOpacity[newIndex] });
    update_captions();
}

addEventListener('keydown', function (e) {
    if (e.target.tagName.toLowerCase() === 'input') {
        // Ignore input when focus is on certain elements, e.g. form fields.
        return;
    }
    // See https://github.com/ctd1500/videojs-hotkeys/blob/bb4a158b2e214ccab87c2e7b95f42bc45c6bfd87/videojs.hotkeys.js#L310-L313
    const isPlayerFocused = false
        || e.target === document.querySelector('.video-js')
        || e.target === document.querySelector('.vjs-tech')
        || e.target === document.querySelector('.iframeblocker')
        || e.target === document.querySelector('.vjs-control-bar')
        ;
    let action = null;

    const code = e.keyCode;
    const decoratedKey =
        e.key
        + (e.altKey ? '+alt' : '')
        + (e.ctrlKey ? '+ctrl' : '')
        + (e.metaKey ? '+meta' : '')
        ;
    switch (decoratedKey) {
        case ' ':
        case 'k':
        case 'MediaPlayPause':
            action = toggle_play;
            break;

        case 'MediaPlay':  action = play; break;
        case 'MediaPause': action = pause; break;
        case 'MediaStop':  action = stop; break;

        case 'ArrowUp':
            if (isPlayerFocused) action = change_volume.bind(this, 0.1);
            break;
        case 'ArrowDown':
            if (isPlayerFocused) action = change_volume.bind(this, -0.1);
            break;

        case 'm':
            action = toggle_muted;
            break;

        case 'ArrowRight':
        case 'MediaFastForward':
            action = skip_seconds.bind(this, 5 * player.playbackRate());
            break;
        case 'ArrowLeft':
        case 'MediaTrackPrevious':
            action = skip_seconds.bind(this, -5 * player.playbackRate());
            break;
        case 'l':
            action = skip_seconds.bind(this, 10 * player.playbackRate());
            break;
        case 'j':
            action = skip_seconds.bind(this, -10 * player.playbackRate());
            break;

        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
            // Ignore numpad numbers
            if (code > 57) break;

            const percent = (code - 48) * 10;
            action = set_time_percent.bind(this, percent);
            break;

        case 'c': action = toggle_captions; break;
        case 'f': action = toggle_fullscreen; break;

        case 'N':
        case 'MediaTrackNext':
            action = next_video;
            break;
        case 'P':
        case 'MediaTrackPrevious':
            // TODO: Add support to play back previous video.
            break;

        // TODO: More precise step. Now FPS is taken equal to 29.97
        // Common FPS: https://forum.videohelp.com/threads/81868#post323588
        // Possible solution is new HTMLVideoElement.requestVideoFrameCallback() https://wicg.github.io/video-rvfc/
        case ',': action = function () { pause(); skip_seconds(-1/29.97); }; break;
        case '.': action = function () { pause(); skip_seconds( 1/29.97); }; break;

        case '>': action = increase_playback_rate.bind(this, 1); break;
        case '<': action = increase_playback_rate.bind(this, -1); break;

        case '=': action = increase_caption_size.bind(this, 1); break;
        case '-': action = increase_caption_size.bind(this, -1); break;

        case 'w': action = toggle_caption_window; break;
        case 'o': action = toggle_caption_opacity; break;

        default:
            console.info('Unhandled key down event: %s:', decoratedKey, e);
            break;
    }

    if (action) {
        e.preventDefault();
        action();
    }
}, false);

// Add support for controlling the player volume by scrolling over it. Adapted from
// https://github.com/ctd1500/videojs-hotkeys/blob/bb4a158b2e214ccab87c2e7b95f42bc45c6bfd87/videojs.hotkeys.js#L292-L328
(function () {
    const pEl = document.getElementById('player');

    var volumeHover = false;
    var volumeSelector = pEl.querySelector('.vjs-volume-menu-button') || pEl.querySelector('.vjs-volume-panel');
    if (volumeSelector !== null) {
        volumeSelector.onmouseover = function () { volumeHover = true; };
        volumeSelector.onmouseout = function () { volumeHover = false; };
    }

    function mouseScroll(event) {
        // When controls are disabled, hotkeys will be disabled as well
        if (!player.controls() || !volumeHover) return;

        event.preventDefault();
        var wheelMove = event.wheelDelta || -event.detail;
        var volumeSign = Math.sign(wheelMove);

        change_volume(volumeSign * 0.05); // decrease/increase by 5%
    }

    player.on('mousewheel', mouseScroll);
    player.on('DOMMouseScroll', mouseScroll);
}());

// show the preferred caption by default
if (player_data.preferred_caption_found) {
    player.ready(function () {
        if (!video_data.params.listen && video_data.params.quality === 'dash') {
            // play.textTracks()[0] on DASH mode is showing some debug messages
            player.textTracks()[1].mode = 'showing';
        } else {
            player.textTracks()[0].mode = 'showing';
        }
    });
}

// Safari audio double duration fix
if (navigator.vendor === 'Apple Computer, Inc.' && video_data.params.listen) {
    function onTimeUpdate() {
        if (
            player.remainingTime() < player.duration() / 2 &&
            player.remainingTime() >= 2
        ) {
            player.currentTime(player.duration() - 1);
        }
    }
    player.on('loadedmetadata', function () {
        var type = (player.currentType() || '').toLowerCase();

        // Always remove any previous listener to avoid duplicates
        player.off('timeupdate', onTimeUpdate);

        // Only attach if the current source contains mp4a
        if (type.indexOf('mp4a') !== -1) {
            player.on('timeupdate', onTimeUpdate);
        }
    });
}

// Safari screen timeout on looped video playback fix
if (navigator.vendor === 'Apple Computer, Inc.' && !video_data.params.listen && video_data.params.video_loop) {
    player.loop(false);
    player.ready(function () {
        player.on('ended', function () {
            player.currentTime(0);
            player.play();
        });
    });
}

// Watch on Invidious link
if (location.pathname.startsWith('/embed/')) {
    const Button = videojs.getComponent('Button');
    let watch_on_invidious_button = new Button(player);

    // Create hyperlink for current instance
    var redirect_element = document.createElement('a');
    redirect_element.setAttribute('href', location.pathname.replace('/embed/', '/watch?v='));
    redirect_element.appendChild(document.createTextNode('Invidious'));

    watch_on_invidious_button.el().appendChild(redirect_element);
    watch_on_invidious_button.addClass('watch-on-invidious');

    var cb = player.getChild('ControlBar');
    cb.addChild(watch_on_invidious_button);
}

addEventListener('DOMContentLoaded', function () {
    // Save time during redirection on another instance
    const changeInstanceLink = document.querySelector('#watch-on-another-invidious-instance > a');
    if (changeInstanceLink) changeInstanceLink.addEventListener('click', function () {
        changeInstanceLink.href = addCurrentTimeToURL(changeInstanceLink.href);
    });
});

// Restore old playback rate button behavior (click to cycle rates)
player.ready(() => {
  const playbackRateButton = player.controlBar.getChild('playbackRateMenuButton');
  
  if (playbackRateButton) {
    // Remove default click handler by overriding onClick
    playbackRateButton.handleClick = function() {
      const rates = this.playbackRates();
      const currentRate = this.player().playbackRate();
      
      // Find next rate, wrap to first if at end
      let newRate = rates[0];
      for (let i = 0; i < rates.length; i++) {
        if (rates[i] > currentRate) {
          newRate = rates[i];
          break;
        }
      }
      
      this.player().playbackRate(newRate);
    };
  }
});
