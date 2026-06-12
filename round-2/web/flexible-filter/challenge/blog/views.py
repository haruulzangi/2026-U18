from django.shortcuts import render
from django.core.exceptions import FieldError
from .models import Post

def post_list(request):
    lookup = request.GET.get('lookup', '')
    value = request.GET.get('value', '')
    match_count = None

    if lookup and value:
        try:
            matches = Post.objects.filter(title='Flag Post').filter(**{lookup: value})
            match_count = matches.count()
        except FieldError:
            match_count = 0
        posts = []
    else:
        posts = Post.objects.exclude(title='Flag Post')

    return render(request, 'blog/post_list.html', {
        'posts': posts,
        'lookup': lookup,
        'value': value,
        'match_count': match_count,
    })