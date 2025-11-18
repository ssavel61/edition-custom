var html = document.documentElement;
var body = document.body;
var timeout;
var st = 0;

cover();
featured();
pagination(true);

window.addEventListener('scroll', function () {
    'use strict';
    if (body.classList.contains('home-template') && body.classList.contains('with-full-cover') && !document.querySelector('.cover').classList.contains('half')) {
        if (timeout) {
            window.cancelAnimationFrame(timeout);
        }
        timeout = window.requestAnimationFrame(portalButton);
    }
});

if (document.querySelector('.cover') && document.querySelector('.cover').classList.contains('half')) {
    body.classList.add('portal-visible');
}

function portalButton() {
    'use strict';
    st = window.scrollY;

    if (st > 300) {
        body.classList.add('portal-visible');
    } else {
        body.classList.remove('portal-visible');
    }
}

function cover() {
    'use strict';
    var cover = document.querySelector('.cover');
    if (!cover) return;

    imagesLoaded(cover, function () {
        cover.classList.remove('image-loading');
    });

    document.querySelector('.cover-arrow').addEventListener('click', function () {
        var element = cover.nextElementSibling;
        element.scrollIntoView({behavior: 'smooth', block: 'start'});
    });
}

function featured() {
    'use strict';
    var feed = document.querySelector('.featured-feed');
    if (!feed) return;

    tns({
        container: feed,
        controlsText: [
            '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M20.547 22.107L14.44 16l6.107-6.12L18.667 8l-8 8 8 8 1.88-1.893z"></path></svg>',
            '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M11.453 22.107L17.56 16l-6.107-6.12L13.333 8l8 8-8 8-1.88-1.893z"></path></svg>',
        ],
        gutter: 30,
        loop: false,
        nav: false,
        responsive: {
            0: {
                items: 1,
            },
            768: {
                items: 2,
            },
            992: {
                items: 3,
            },
        },
    });
}
function pagination(isInfinite) {
    var feed = document.querySelector('.gh-feed');
    var nav = document.querySelector('.pagination');
    var next = document.querySelector('link[rel="next"]');
    var loadMore = document.querySelector('.older-posts');
    var marker = document.querySelector('#infinite-scroll-marker');

    if (!feed || !nav || !marker) return;

    if (loadMore) {
        nav.style.display = 'block';
    }

    function fetchNextPage() {
        var nextLink = document.querySelector('link[rel="next"]');
        if (!nextLink) return;

        var url = nextLink.getAttribute('href');
        if (loading === true) return;

        nav.classList.add('loading');
        loading = true;

        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'document';

        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 400) {
                var newNodes = xhr.response.querySelectorAll('.gh-feed > *');
                var nextLinkUrl = xhr.response.querySelector('link[rel="next"]');

                newNodes.forEach(function (node) {
                    feed.appendChild(document.importNode(node, true));
                });

                if (nextLinkUrl) {
                    nextLink.setAttribute('href', nextLinkUrl.getAttribute('href'));
                } else {
                    // No more pages
                    window.removeEventListener('scroll', onScroll);
                    if (marker) marker.remove();
                    nav.remove();
                }

                nav.classList.remove('loading');
                loading = false;
            }
        };

        xhr.send();
    }

    var loading = false;

    if (isInfinite) {
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    fetchNextPage();
                }
            });
        });

        observer.observe(marker);
    } else {
        // Fallback for load more button if infinite scroll is off
        loadMore.addEventListener('click', function (e) {
            e.preventDefault();
            fetchNextPage();
        });
    }
}
